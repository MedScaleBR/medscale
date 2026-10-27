import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sendHandoffPush = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/supabase/server', async () => {
  const h = await import('../helpers/agent-harness')
  return { createAdminClient: () => h.state.supabase.client, createClient: async () => h.state.supabase.client }
})
vi.mock('@/lib/bot/config', async () => {
  const h = await import('../helpers/agent-harness')
  return { getBotConfig: async () => h.state.botConfig, getAccountUnits: async () => h.state.units, invalidateBotConfigCache: () => {} }
})
vi.mock('@/lib/whatsapp/send', async () => {
  const h = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: h.sendWhatsAppMessage }
})
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => `decrypted:${t}`, encryptToken: (t: string) => t }))
vi.mock('@/lib/google/availability', async () => {
  const h = await import('../helpers/agent-harness')
  return { getFreeSlotsForBot: h.getFreeSlotsForBot, isSlotAvailable: h.isSlotAvailable }
})
vi.mock('@/lib/google/auth', async () => {
  const h = await import('../helpers/agent-harness')
  return { isGoogleConnected: async () => ({ connected: h.state.googleConnected, email: h.state.googleEmail }) }
})
vi.mock('@/lib/google/calendar', async () => {
  const h = await import('../helpers/agent-harness')
  return { createEvent: h.createEvent, cancelEvent: h.cancelEvent, deleteEvent: h.deleteEvent }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const h = await import('../helpers/agent-harness')
  return { default: class { messages = { create: h.claudeCreate } } }
})
vi.mock('@/lib/realtime/broadcast', () => ({ broadcastToWorkspace: vi.fn(), workspaceChannel: (id: string) => `handoff-toast:${id}` }))
vi.mock('@/lib/push/send', () => ({ sendHandoffPush }))

import { processIncomingMessage } from '@/lib/llm/agent'
import { mergeSupabaseConfig, resetAgentHarness, sentMessages, state, UNIT, PARAMS, getFreeSlotsForBot } from '../helpers/agent-harness'
import {
  EXTERNAL_BOOKING_BLOCKED_MESSAGE,
  externalRequestInHoursMessage,
  externalRequestOutOfHoursMessage,
  intakeMissingMessage,
  type WorkspaceBotSettings,
} from '@/lib/bot/unit-settings'

const SLOT = '2026-10-28T08:00-03:00'
const INSURER = { id: '11111111-1111-4111-8111-111111111111', name: 'Bradesco Saúde' }
const MARIA = { id: 'p1', full_name: 'Maria da Silva', birth_date: '1980-03-15' }
const SECRET_NAME = 'Maria da Silva'

function unit(settings: WorkspaceBotSettings) {
  state.units = [{ ...UNIT, name: 'Clínica Norte', botSettings: settings }]
}

const externalUnit = (fields: WorkspaceBotSettings['intakeFields']) =>
  unit({ schedulingMode: 'external', intakeFields: fields, botInstructions: null })

function supabase(opts: { patient?: Record<string, unknown>; inHours?: boolean; insurers?: unknown[] } = {}) {
  return mergeSupabaseConfig({
    patients: { select: { data: { ...(opts.patient ?? MARIA) } }, update: { data: null } },
    appointments: { select: { data: [] }, insert: { data: { id: 'appt-1', patient_name: 'x', patient_phone: 'y', type: 'consulta' } }, update: { data: null } },
    health_insurers: { select: { data: opts.insurers ?? [INSURER] } },
    // Fora do horário: a unidade tem cadastro de handoff, mas nenhum vale agora.
    handoff_hours: { select: { data: [], count: opts.inHours === false ? 1 : 0 } },
    handoff_logs: { insert: { data: null }, select: { data: null }, update: { data: null } },
  })
}

let logs: string[] = []

describe('Clara por unidade — fluxo do agente', () => {
  beforeEach(() => {
    resetAgentHarness()
    sendHandoffPush.mockClear()
    logs = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
  })
  afterEach(() => vi.restoreAllMocks())

  it('AGENDAMENTO_CONFIRMADO em unidade external é ignorado', async () => {
    externalUnit(['full_name', 'insurance'])
    const s = supabase()
    state.claudeResponses = [`Pronto, sua consulta está marcada!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: PARTICULAR`]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(sentMessages()).toEqual([EXTERNAL_BOOKING_BLOCKED_MESSAGE])
    expect(logs.some((l) => l.includes('AGENDAMENTO_CONFIRMADO ignorado em unidade externa workspace=w1'))).toBe(true)
  })

  it('unidade external não consulta horários livres', async () => {
    externalUnit(['full_name', 'insurance'])
    supabase()
    state.claudeResponses = ['Oi!']

    await processIncomingMessage(PARAMS)

    expect(getFreeSlotsForBot).not.toHaveBeenCalled()
  })

  it('SOLICITACAO com campo faltando: não transfere, pede o dado e loga só os nomes dos campos', async () => {
    externalUnit(['full_name', 'birth_date', 'insurance', 'preference'])
    const s = supabase()
    state.claudeResponses = [`Vou passar para a equipe.\nNOME_PACIENTE: ${SECRET_NAME}\nCONVENIO_ID: ${INSURER.id}\nSOLICITACAO_AGENDAMENTO`]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('handoff_logs', 'insert')).toHaveLength(0)
    expect(s.callsTo('conversations', 'update').some((c) => (c.payload as { bot_paused?: boolean }).bot_paused)).toBe(false)
    expect(sentMessages()).toEqual([intakeMissingMessage(['insurance', 'preference'])])
    expect(logs).toContainEqual(expect.stringContaining('missing_fields=insurance,preference trigger_reason=external_scheduling workspace=w1'))
  })

  it('SOLICITACAO completa no horário: handoff com resumo e push', async () => {
    externalUnit(['full_name', 'birth_date', 'insurance', 'preference'])
    const s = supabase()
    state.claudeResponses = [
      [
        'Perfeito, vou passar para a equipe confirmar.',
        `NOME_PACIENTE: ${SECRET_NAME}`,
        'DATA_NASCIMENTO: 1980-03-15',
        `CONVENIO_ID: ${INSURER.id}`,
        'CARTEIRINHA: 123456',
        'CPF: 52998224725',
        'PREFERENCIA_HORARIO: terça de manhã',
        'SOLICITACAO_AGENDAMENTO',
      ].join('\n'),
    ]

    await processIncomingMessage(PARAMS)

    const [log] = s.callsTo('handoff_logs', 'insert')
    expect(log.payload).toMatchObject({
      workspace_id: 'w1',
      trigger_reason: 'external_scheduling',
      summary: {
        workspace_id: 'w1',
        phone: `+${PARAMS.patientPhone}`,
        full_name: SECRET_NAME,
        birth_date: '1980-03-15',
        particular: false,
        insurance: { convenio_id: INSURER.id, name: INSURER.name, card_number: '123456' },
        preference: 'terça de manhã',
      },
    })
    // A unidade não coleta CPF: não entra no resumo nem é gravado no paciente.
    expect((log.payload as { summary: Record<string, unknown> }).summary).not.toHaveProperty('cpf')
    expect(s.callsTo('patients', 'update').some((c) => 'cpf' in (c.payload as object))).toBe(false)
    expect(s.callsTo('conversations', 'update')).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'handoff', bot_paused: true }) })
    )
    expect(sentMessages()[0]).toBe(externalRequestInHoursMessage('Clínica Norte'))
    expect(sendHandoffPush).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ title: '📋 Solicitação de agendamento', body: expect.stringContaining('Preferência: terça de manhã') })
    )
    // LGPD: nenhum dado do paciente nos logs.
    for (const secret of [SECRET_NAME, '1980-03-15', '123456', 'terça de manhã', PARAMS.patientPhone]) {
      expect(logs.join('\n')).not.toContain(secret)
    }
  })

  it('SOLICITACAO fora do horário: fica pendente, avisa a equipe e não pausa o bot', async () => {
    externalUnit(['full_name', 'insurance'])
    const s = supabase({ inHours: false, insurers: [] })
    state.claudeResponses = [`Ok!\nNOME_PACIENTE: ${SECRET_NAME}\nCONVENIO_ID: PARTICULAR\nSOLICITACAO_AGENDAMENTO`]

    await processIncomingMessage(PARAMS)

    const [log] = s.callsTo('handoff_logs', 'insert')
    expect(log.payload).toMatchObject({
      trigger_reason: 'external_scheduling',
      summary: { full_name: SECRET_NAME, particular: true },
    })
    expect(s.callsTo('conversations', 'update').some((c) => (c.payload as { bot_paused?: boolean }).bot_paused)).toBe(false)
    expect(sentMessages()).toEqual([externalRequestOutOfHoursMessage('Clínica Norte')])
    expect(sendHandoffPush).toHaveBeenCalledWith('w1', expect.objectContaining({ title: '📋 Solicitação de agendamento' }))
  })

  it('SOLICITACAO em unidade internal é ignorada', async () => {
    unit({ schedulingMode: 'internal', intakeFields: [], botInstructions: null })
    const s = supabase()
    state.claudeResponses = ['Tudo certo.\nSOLICITACAO_AGENDAMENTO']

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('handoff_logs', 'insert')).toHaveLength(0)
    expect(sentMessages()).toEqual(['Tudo certo.'])
    expect(logs).toContainEqual(expect.stringContaining('SOLICITACAO_AGENDAMENTO ignorado em unidade internal workspace=w1'))
  })

  it('internal com nascimento obrigatório: sem a data não agenda', async () => {
    unit({ schedulingMode: 'internal', intakeFields: ['birth_date'], botInstructions: null })
    const s = supabase({ patient: { id: 'p1', full_name: SECRET_NAME, birth_date: null }, insurers: [] })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(sentMessages()).toEqual([intakeMissingMessage(['birth_date'])])
    expect(logs).toContainEqual(expect.stringContaining('missing_fields=birth_date trigger_reason=booking workspace=w1'))
  })

  it('internal com nascimento obrigatório: com DATA_NASCIMENTO na mesma resposta, agenda', async () => {
    unit({ schedulingMode: 'internal', intakeFields: ['birth_date', 'reason'], botInstructions: null })
    const s = supabase({ patient: { id: 'p1', full_name: SECRET_NAME, birth_date: null }, insurers: [] })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nDATA_NASCIMENTO: 1980-03-15\nMOTIVO_CONSULTA: dor no joelho`]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('patients', 'update')).toContainEqual(expect.objectContaining({ payload: { birth_date: '1980-03-15' } }))
    expect(s.callsTo('appointments', 'insert')[0]?.payload).toMatchObject({ status: 'agendado', reason: 'dor no joelho' })
    expect(sentMessages()).toEqual(['Agendado!'])
  })

  it('unidade no padrão: agendamento igual ao de hoje, sem coluna nova no insert', async () => {
    const s = supabase({ insurers: [] })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nMOTIVO_CONSULTA: dor`]

    await processIncomingMessage(PARAMS)

    const payload = s.callsTo('appointments', 'insert')[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({ status: 'agendado' })
    expect(payload).not.toHaveProperty('reason')
    // Nenhuma leitura extra do paciente para a coleta.
    expect(s.callsTo('patients', 'select')).toHaveLength(1)
  })
})
