import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'
import { validateSOAPRecord, SOAPValidationError, type SOAPRecord } from '@/lib/transcriptions/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  claudeCreate: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => g.claudeCreate(...args) }
  },
}))

import { generateSOAP } from '@/lib/transcriptions/generate-soap'
import { POST as generateRecord } from '@/app/api/transcriptions/generate-record/route'

const CRON_SECRET = 'cron-secret-test'

const MINIMAL: SOAPRecord = {
  soap: {
    S: { queixa_principal: 'Dor de cabeça', historia_atual: 'Há três dias.', antecedentes: null, medicamentos_em_uso: [] },
    O: { exame_fisico: null, exames_solicitados: [], exames_resultados: null },
    A: { hipotese_diagnostica: 'Cefaleia tensional', diagnosticos_secundarios: [], cid10: null },
    P: { prescricao: [], orientacoes: [], retorno: null, encaminhamentos: [] },
  },
  resumo: 'Consulta de rotina.',
  alertas: ['exame_fisico não informado'],
}

/** O código faz prefill com "{" — o mock devolve o JSON já sem a primeira chave. */
function claudeReturns(json: string) {
  g.claudeCreate = vi.fn(async () => ({ content: [{ type: 'text', text: json.replace(/^\s*\{/, '') }] }))
}

function claudeReturnsRaw(text: string) {
  g.claudeCreate = vi.fn(async () => ({ content: [{ type: 'text', text }] }))
}

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ transcriptions: { select: { data: null }, update: { data: null } }, ...config })
  return g.supabase
}

function request(body: unknown, secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/transcriptions/generate-record', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as never
}

describe('validateSOAPRecord — contrato do prontuário SOAP', () => {
  it('deve aceitar SOAPRecord com campos opcionais como null', () => {
    expect(() => validateSOAPRecord(MINIMAL)).not.toThrow()
    expect(validateSOAPRecord(MINIMAL)).toEqual(MINIMAL)
  })

  it('deve descartar campos extras inventados pelo modelo', () => {
    const comExtras = {
      ...MINIMAL,
      campo_inventado: 'lixo',
      soap: { ...MINIMAL.soap, X: { qualquer: 'coisa' }, S: { ...MINIMAL.soap.S, extra: 1 } },
    }
    const validated = validateSOAPRecord(comExtras)
    expect(validated).toEqual(MINIMAL)
    expect(validated.soap).not.toHaveProperty('X')
    expect(validated.soap.S).not.toHaveProperty('extra')
  })

  it('deve normalizar arrays ausentes ou null para array vazio', () => {
    const semArrays = {
      soap: {
        S: { queixa_principal: 'Dor', historia_atual: 'Ontem.' },
        O: {},
        A: { hipotese_diagnostica: 'Cefaleia' },
        P: { prescricao: null },
      },
      resumo: 'Resumo.',
    }
    const validated = validateSOAPRecord(semArrays)
    expect(validated.soap.S.medicamentos_em_uso).toEqual([])
    expect(validated.soap.P.prescricao).toEqual([])
    expect(validated.alertas).toEqual([])
    expect(validated.soap.O.exame_fisico).toBeNull()
  })

  it('deve tratar string vazia em campo opcional como null', () => {
    const validated = validateSOAPRecord({ ...MINIMAL, soap: { ...MINIMAL.soap, A: { ...MINIMAL.soap.A, cid10: '' } } })
    expect(validated.soap.A.cid10).toBeNull()
  })

  it('deve lançar quando a queixa principal está ausente', () => {
    const semQueixa = { ...MINIMAL, soap: { ...MINIMAL.soap, S: { historia_atual: 'Há três dias.' } } }
    expect(() => validateSOAPRecord(semQueixa)).toThrow(SOAPValidationError)
    expect(() => validateSOAPRecord(semQueixa)).toThrow(/queixa_principal/)
  })

  it('deve lançar quando a hipótese diagnóstica vem null', () => {
    const semHipotese = { ...MINIMAL, soap: { ...MINIMAL.soap, A: { ...MINIMAL.soap.A, hipotese_diagnostica: null } } }
    expect(() => validateSOAPRecord(semHipotese)).toThrow(/hipotese_diagnostica/)
  })

  it('deve lançar quando um campo obrigatório vem como string vazia', () => {
    const vazio = { ...MINIMAL, resumo: '   ' }
    expect(() => validateSOAPRecord(vazio)).toThrow(/resumo/)
  })

  it('deve lançar quando uma seção do SOAP está ausente', () => {
    const semP = { ...MINIMAL, soap: { S: MINIMAL.soap.S, O: MINIMAL.soap.O, A: MINIMAL.soap.A } }
    expect(() => validateSOAPRecord(semP)).toThrow(/soap.P/)
  })

  it('deve lançar quando um array obrigatório vem com item que não é string', () => {
    const listaSuja = {
      ...MINIMAL,
      soap: { ...MINIMAL.soap, P: { ...MINIMAL.soap.P, prescricao: ['Dipirona', { dose: '500mg' }] } },
    }
    expect(() => validateSOAPRecord(listaSuja)).toThrow(/prescricao/)
  })

  it('deve lançar quando a resposta não é um objeto', () => {
    expect(() => validateSOAPRecord('texto solto')).toThrow(SOAPValidationError)
    expect(() => validateSOAPRecord(null)).toThrow(SOAPValidationError)
    expect(() => validateSOAPRecord([MINIMAL])).toThrow(SOAPValidationError)
  })
})

describe('generateSOAP — chamada ao Claude', () => {
  beforeEach(() => {
    setup()
  })

  it('deve devolver o SOAPRecord quando o Claude responde com JSON válido', async () => {
    claudeReturns(JSON.stringify(MINIMAL))
    await expect(generateSOAP('Paciente relata dor de cabeça há três dias.')).resolves.toEqual(MINIMAL)
  })

  it('deve remover o fence de markdown quando o Claude embrulha o JSON', async () => {
    claudeReturnsRaw('```json\n' + JSON.stringify(MINIMAL) + '\n```')
    await expect(generateSOAP('Transcrição qualquer.')).resolves.toEqual(MINIMAL)
  })

  it('deve lançar erro descritivo quando o Claude devolve texto fora do JSON', async () => {
    claudeReturnsRaw('Desculpe, não consigo gerar esse prontuário.')
    await expect(generateSOAP('Transcrição qualquer.')).rejects.toThrow(/invalid JSON/)
  })

  it('deve lançar erro quando o JSON é válido mas está fora do contrato SOAPRecord', async () => {
    claudeReturns(JSON.stringify({ soap: { S: {}, O: {}, A: {}, P: {} }, resumo: 'x' }))
    await expect(generateSOAP('Transcrição qualquer.')).rejects.toThrow(/invalid SOAP record/)
  })

  it('deve enviar a transcrição para o Claude no corpo da mensagem', async () => {
    claudeReturns(JSON.stringify(MINIMAL))
    await generateSOAP('Paciente relata dor de cabeça há três dias.')

    const call = (g.claudeCreate.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>)[0][0]
    expect(call.messages[0].content).toContain('Paciente relata dor de cabeça há três dias.')
  })
})

describe('POST /api/transcriptions/generate-record — geração do prontuário', () => {
  beforeEach(() => {
    claudeReturns(JSON.stringify(MINIMAL))
  })

  it('deve retornar 401 quando o segredo de cron está ausente', async () => {
    setup()
    const res = await generateRecord(request({ transcription_id: 't1' }, null))
    expect(res.status).toBe(401)
  })

  it('deve retornar 401 quando o segredo de cron está errado', async () => {
    setup()
    const res = await generateRecord(request({ transcription_id: 't1' }, 'segredo-errado'))
    expect(res.status).toBe(401)
  })

  it('deve retornar 400 quando o registro não tem transcript_text', async () => {
    setup({ transcriptions: { select: { data: { transcript_text: null, retry_count: 0 } }, update: { data: null } } })
    const res = await generateRecord(request({ transcription_id: 't1' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'No transcript text' })
  })

  it('deve salvar o rascunho e marcar draft_ready quando o Claude devolve JSON válido', async () => {
    const supabase = setup({
      transcriptions: { select: { data: { transcript_text: 'Consulta gravada.', retry_count: 0 } }, update: { data: null } },
    })
    const res = await generateRecord(request({ transcription_id: 't1' }))

    expect(res.status).toBe(200)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({
      medical_record_draft: MINIMAL,
      status: 'draft_ready',
      retry_count: 0,
      error_message: null,
    })
  })

  it('deve voltar para transcribed e re-disparar quando o parse falha na primeira tentativa', async () => {
    claudeReturnsRaw('não é json')
    const supabase = setup({
      transcriptions: { select: { data: { transcript_text: 'Consulta gravada.', retry_count: 0 } }, update: { data: null } },
    })
    const res = await generateRecord(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'transcribed', retry_count: 1 })
    expect(String((final?.payload as { error_message: string }).error_message)).toContain('invalid JSON')
    expect(supabase.rpc).toHaveBeenCalledWith('trigger_transcription_generate', expect.objectContaining({ p_transcription_id: 't1' }))
  })

  it('deve marcar status error e não re-disparar na terceira falha', async () => {
    claudeReturnsRaw('continua não sendo json')
    const supabase = setup({
      transcriptions: { select: { data: { transcript_text: 'Consulta gravada.', retry_count: 2 } }, update: { data: null } },
    })
    const res = await generateRecord(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'error' })
    expect((final?.payload as { error_message: string }).error_message).toBeTruthy()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deve tratar JSON fora do contrato como falha, sem salvar prontuário incompleto', async () => {
    claudeReturns(JSON.stringify({ soap: { S: {}, O: {}, A: {}, P: {} }, resumo: 'x' }))
    const supabase = setup({
      transcriptions: { select: { data: { transcript_text: 'Consulta gravada.', retry_count: 0 } }, update: { data: null } },
    })
    await generateRecord(request({ transcription_id: 't1' }))

    const salvos = supabase
      .callsTo('transcriptions', 'update')
      .filter((c) => (c.payload as { medical_record_draft?: unknown }).medical_record_draft !== undefined)
    expect(salvos).toHaveLength(0)
  })
})
