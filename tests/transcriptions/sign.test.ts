import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { SOAPRecord } from '@/lib/transcriptions/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session
        ? { session: g.session }
        : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireModule: (session: { modules: string[] }, mod: string) =>
      session.modules.includes(mod)
        ? null
        : NR.json({ error: `Módulo '${mod}' não está ativo no seu plano` }, { status: 403 }),
  }
})

import { POST as sign } from '@/app/api/transcriptions/[id]/sign/route'

const SESSION = {
  userId: 'u1',
  accountId: 'acc1',
  workspaceId: 'w1',
  role: 'owner',
  modules: ['transcriptions'],
}

const RECORD: SOAPRecord = {
  soap: {
    S: { queixa_principal: 'Dor de cabeça', historia_atual: 'Há três dias.', antecedentes: null, medicamentos_em_uso: [] },
    O: { exame_fisico: null, exames_solicitados: [], exames_resultados: null },
    A: { hipotese_diagnostica: 'Cefaleia tensional', diagnosticos_secundarios: [], cid10: null },
    P: { prescricao: ['Dipirona 500mg'], orientacoes: [], retorno: null, encaminhamentos: [] },
  },
  resumo: 'Consulta de rotina.',
  alertas: [],
}

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    transcriptions: { select: { data: null }, update: { data: null, error: null } },
    appointments: { update: { data: null } },
    ...config,
  })
  return g.supabase
}

function request(body: unknown) {
  return new Request('https://app.test/api/transcriptions/t1/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const params = Promise.resolve({ id: 't1' })

describe('POST /api/transcriptions/[id]/sign — assinatura do prontuário', () => {
  beforeEach(() => {
    g.session = { ...SESSION }
    setup()
  })

  it('deve retornar 401 quando o usuário não tem sessão válida', async () => {
    g.session = null
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(401)
  })

  it('deve retornar 403 quando o módulo transcriptions não está ativo na account', async () => {
    g.session = { ...SESSION, modules: [] }
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(403)
  })

  it('deve retornar 400 quando medical_record_final está ausente no corpo', async () => {
    const res = await sign(request({}), { params })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'medical_record_final é obrigatório' })
  })

  it('deve retornar 404 quando a transcrição não existe na workspace atual', async () => {
    setup({ transcriptions: { select: { data: null }, update: { data: null } } })
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(404)
  })

  it('deve buscar a transcrição restrita à workspace da sessão', async () => {
    const supabase = setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'draft_ready' } }, update: { data: null } },
    })
    await sign(request({ medical_record_final: RECORD }), { params })

    const select = supabase.callsTo('transcriptions', 'select')[0]
    expect(select.filters).toContainEqual(['eq', 'workspace_id', 'w1'])
    expect(select.filters).toContainEqual(['eq', 'id', 't1'])
  })

  it('deve retornar 409 quando a transcrição já está assinada', async () => {
    setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'signed' } }, update: { data: null } },
    })
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Já assinado' })
  })

  it('não deve sobrescrever o prontuário quando ele já está assinado', async () => {
    const supabase = setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'signed' } }, update: { data: null } },
    })
    await sign(request({ medical_record_final: RECORD }), { params })

    expect(supabase.callsTo('transcriptions', 'update')).toHaveLength(0)
  })

  it('deve gravar status signed com signed_at e signed_by quando a assinatura é válida', async () => {
    const supabase = setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'draft_ready' } }, update: { data: null } },
    })
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(200)
    const update = supabase.callsTo('transcriptions', 'update')[0]
    expect(update?.payload).toMatchObject({
      medical_record_final: RECORD,
      status: 'signed',
      signed_by: 'u1',
    })
    expect((update?.payload as { signed_at: string }).signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('deve marcar a consulta como realizada quando há appointment_id associado', async () => {
    const supabase = setup({
      transcriptions: {
        select: { data: { id: 't1', appointment_id: 'appt-1', status: 'draft_ready' } },
        update: { data: null },
      },
    })
    await sign(request({ medical_record_final: RECORD }), { params })

    const update = supabase.callsTo('appointments', 'update')[0]
    expect(update?.payload).toEqual({ status: 'realizado' })
    expect(update?.filters).toContainEqual(['eq', 'id', 'appt-1'])
  })

  it('não deve tocar em nenhuma consulta quando não há appointment_id', async () => {
    const supabase = setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'draft_ready' } }, update: { data: null } },
    })
    await sign(request({ medical_record_final: RECORD }), { params })

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('deve retornar 500 e não marcar a consulta quando a gravação da assinatura falha', async () => {
    const supabase = setup({
      transcriptions: {
        select: { data: { id: 't1', appointment_id: 'appt-1', status: 'draft_ready' } },
        update: { data: null, error: { message: 'permissão negada' } },
      },
    })
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res.status).toBe(500)
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('deve usar NextResponse com JSON em todas as respostas', async () => {
    // Garante que o handler devolve uma resposta HTTP de verdade, não um objeto solto.
    setup({
      transcriptions: { select: { data: { id: 't1', appointment_id: null, status: 'draft_ready' } }, update: { data: null } },
    })
    const res = await sign(request({ medical_record_final: RECORD }), { params })

    expect(res).toBeInstanceOf(NextResponse)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })
})
