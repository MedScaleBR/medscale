import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sendHandoffPush = vi.hoisted(() => vi.fn(async () => undefined))
const mailer = vi.hoisted(() => ({
  configured: true,
  sendMail: vi.fn<(p: unknown) => Promise<{ sent: boolean; error?: string }>>(async () => ({ sent: true })),
}))

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
vi.mock('@/lib/email/mailer', () => ({
  isMailerConfigured: () => mailer.configured,
  sendMail: mailer.sendMail,
}))

import { processIncomingMessage } from '@/lib/llm/agent'
import { claudeCreate, mergeSupabaseConfig, resetAgentHarness, sentMessages, state, UNIT, PARAMS } from '../helpers/agent-harness'
import { externalRequestInHoursMessage, type WorkspaceBotSettings } from '@/lib/bot/unit-settings'

const W1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const W2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UNIMED = '11111111-1111-4111-8111-111111111111'
const AMIL = '33333333-3333-4333-8333-333333333333'
const MARIA = { id: 'p1', full_name: 'Maria da Silva', birth_date: '1980-03-15' }
const SECRET_CARD = '987654321'

const external = (fields: WorkspaceBotSettings['intakeFields']): WorkspaceBotSettings => ({
  schedulingMode: 'external',
  intakeFields: fields,
  botInstructions: null,
})

function setup(opts: { emails?: string[] | null; card?: boolean; insurers?: unknown[] } = {}) {
  return mergeSupabaseConfig({
    patients: { select: { data: { ...MARIA } }, update: { data: null } },
    appointments: { select: { data: [] }, insert: { data: { id: 'appt-1' } }, update: { data: null } },
    health_insurers: {
      select: {
        data: opts.insurers ?? [
          { id: UNIMED, name: 'Unimed', health_insurer_workspaces: [{ workspace_id: W1 }] },
          { id: AMIL, name: 'Amil', health_insurer_workspaces: [{ workspace_id: W1 }, { workspace_id: W2 }] },
        ],
      },
    },
    handoff_hours: { select: { data: [], count: 0 } },
    handoff_logs: { insert: { data: null }, select: { data: { id: 'log-1' } }, update: { data: null } },
    workspaces: {
      select:
        opts.emails === null
          ? { data: null, error: { message: 'column does not exist' } }
          : { data: { notification_emails: opts.emails ?? [] } },
    },
    conversation_attachments: {
      select: { data: opts.card ? { id: 'att-1', storage_path: 'acc/conv/1.jpg', mime_type: 'image/jpeg' } : null },
    },
  })
}

function twoUnits(fields: WorkspaceBotSettings['intakeFields']) {
  state.units = [
    { ...UNIT, id: W1, name: 'Centro', botSettings: external(fields), acceptsPrivate: true },
    { ...UNIT, id: W2, name: 'Barra', botSettings: external(fields), acceptsPrivate: true },
  ]
}

function systemPrompt(): string {
  const call = claudeCreate.mock.calls[0] as unknown as [{ system: unknown }]
  return JSON.stringify(call[0].system)
}

const request = (unitId: string, insurerId: string) =>
  [
    'Vou passar para a equipe.',
    `UNIDADE_ID: ${unitId}`,
    `NOME_PACIENTE: ${MARIA.full_name}`,
    `CONVENIO_ID: ${insurerId}`,
    `CARTEIRINHA: ${SECRET_CARD}`,
    'SOLICITACAO_AGENDAMENTO',
  ].join('\n')

let logs: string[] = []

describe('Clara — convênio antes da unidade, carteirinha e e-mail', () => {
  beforeEach(() => {
    resetAgentHarness()
    sendHandoffPush.mockClear()
    mailer.sendMail.mockClear()
    mailer.configured = true
    logs = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
  })
  afterEach(() => vi.restoreAllMocks())

  it('com ask_insurance_first, o prompt pede o convênio antes e mostra onde cada convênio é aceito', async () => {
    twoUnits(['full_name', 'insurance'])
    state.botConfig = { ...state.botConfig!, askInsuranceFirst: true }
    setup({ insurers: [{ id: AMIL, name: 'Amil', health_insurer_workspaces: [{ workspace_id: W1 }, { workspace_id: W2 }] }] })

    await processIncomingMessage(PARAMS)

    const prompt = systemPrompt()
    expect(prompt).toContain('ORDEM DO AGENDAMENTO')
    expect(prompt).toContain('Nunca ofereça uma unidade que não aceita o convênio do paciente.')
    expect(prompt).toContain('Pergunte primeiro o convênio do paciente')
    // Cobertura igual nas duas unidades, mas a lista diz onde o convênio vale.
    expect(prompt).toContain(`Amil (id: ${AMIL}) — aceito em: Centro, Barra`)
  })

  it('sem ask_insurance_first, o prompt não muda', async () => {
    twoUnits(['full_name', 'insurance'])
    setup({ insurers: [{ id: AMIL, name: 'Amil', health_insurer_workspaces: [{ workspace_id: W1 }, { workspace_id: W2 }] }] })

    await processIncomingMessage(PARAMS)

    const prompt = systemPrompt()
    expect(prompt).not.toContain('ORDEM DO AGENDAMENTO')
    expect(prompt).not.toContain('aceito em:')
    expect(prompt).toContain('Pergunte em qual unidade o paciente quer ser atendido')
  })

  it('SOLICITACAO com convênio que a unidade não aceita: não transfere e loga insurer_not_accepted só com ids', async () => {
    twoUnits(['full_name', 'insurance'])
    const s = setup({ emails: ['a@b.com'] })
    state.claudeResponses = [request(W2, UNIMED)]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('handoff_logs', 'insert')).toHaveLength(0)
    expect(sentMessages()[0]).toContain('A unidade Barra não atende pelo Unimed')
    expect(sentMessages()[0]).toContain('Centro')
    expect(logs).toContainEqual(
      `[insurance] insurer_not_accepted marker=SOLICITACAO_AGENDAMENTO workspace=${W2} insurer=${UNIMED}`
    )
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })

  it('unidade com foto: o prompt pede a foto e o resumo diz "não enviada" sem bloquear', async () => {
    state.units = [{ ...UNIT, id: W1, name: 'Centro', botSettings: external(['full_name', 'insurance', 'insurance_card_photo']) }]
    const s = setup()
    state.claudeResponses = [request(W1, UNIMED)]

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).toContain('Peça também uma foto da carteirinha do convênio')
    const [log] = s.callsTo('handoff_logs', 'insert')
    expect(log.payload).toMatchObject({ summary: { insurance_card_photo: 'missing' } })
    expect(sentMessages()[0]).toBe(externalRequestInHoursMessage('Centro'))
    expect(sendHandoffPush).toHaveBeenCalledWith(W1, expect.objectContaining({
      body: expect.stringContaining('Foto da carteirinha: não enviada'),
    }))
  })

  it('solicitação válida manda e-mail com resumo, link e a foto em anexo; grava email_sent_at', async () => {
    state.units = [{ ...UNIT, id: W1, name: 'Centro', botSettings: external(['full_name', 'insurance', 'insurance_card_photo']) }]
    const s = setup({ emails: ['secretaria@clinica.com', 'medico@clinica.com'], card: true })
    s.storage.download.mockResolvedValueOnce({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    state.claudeResponses = [request(W1, UNIMED)]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('handoff_logs', 'insert')[0].payload).toMatchObject({ summary: { insurance_card_photo: 'sent' } })
    expect(mailer.sendMail).toHaveBeenCalledTimes(1)
    const mail = mailer.sendMail.mock.calls[0][0] as {
      to: string[]
      subject: string
      text: string
      attachments: { filename: string; contentType: string }[]
    }
    expect(mail.to).toEqual(['secretaria@clinica.com', 'medico@clinica.com'])
    expect(mail.subject).toBe('Nova solicitação de agendamento — Maria da Silva — Centro')
    expect(mail.text).toContain(`Carteirinha: ${SECRET_CARD}`)
    expect(mail.text).toContain('Foto da carteirinha: enviada')
    expect(mail.text).toContain('/bot?c=')
    expect(mail.attachments).toEqual([expect.objectContaining({ filename: 'carteirinha.jpg', contentType: 'image/jpeg' })])
    expect(s.callsTo('handoff_logs', 'update')).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ email_sent_at: expect.any(String) }) })
    )
    // LGPD: logs sem nome, telefone, carteirinha nem e-mail.
    for (const secret of [MARIA.full_name, SECRET_CARD, PARAMS.patientPhone, 'secretaria@clinica.com']) {
      expect(logs.join('\n')).not.toContain(secret)
    }
  })

  it('falha no e-mail não desfaz o handoff e loga só email_failed com o id', async () => {
    state.units = [{ ...UNIT, id: W1, name: 'Centro', botSettings: external(['full_name', 'insurance']) }]
    const s = setup({ emails: ['a@b.com'] })
    mailer.sendMail.mockResolvedValueOnce({ sent: false, error: 'smtp down a@b.com' })
    state.claudeResponses = [request(W1, UNIMED)]

    await processIncomingMessage(PARAMS)

    expect(s.callsTo('handoff_logs', 'insert')).toHaveLength(1)
    expect(logs).toContainEqual('[email] email_failed handoff_log_id=log-1')
    expect(logs.join('\n')).not.toContain('a@b.com')
    expect(s.callsTo('handoff_logs', 'update').some((c) => 'email_sent_at' in (c.payload as object))).toBe(false)
  })

  it('sem SMTP ou sem e-mails na unidade, pula o envio em silêncio', async () => {
    state.units = [{ ...UNIT, id: W1, name: 'Centro', botSettings: external(['full_name', 'insurance']) }]
    setup({ emails: [] })
    state.claudeResponses = [request(W1, UNIMED)]
    await processIncomingMessage(PARAMS)
    expect(mailer.sendMail).not.toHaveBeenCalled()

    resetAgentHarness()
    mailer.configured = false
    state.units = [{ ...UNIT, id: W1, name: 'Centro', botSettings: external(['full_name', 'insurance']) }]
    const s = setup({ emails: ['a@b.com'] })
    state.claudeResponses = [request(W1, UNIMED)]
    await processIncomingMessage(PARAMS)
    expect(mailer.sendMail).not.toHaveBeenCalled()
    expect(s.callsTo('handoff_logs', 'insert')).toHaveLength(1)
  })
})
