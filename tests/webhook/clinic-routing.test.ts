import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  afterCallbacks: [] as Array<() => unknown>,
  processIncomingMessage: null as unknown as MockFn,
  handleUnsupportedMessage: null as unknown as MockFn,
  resolveClinicSender: vi.fn(),
  processClinicReplyMessage: vi.fn(),
  notifyOutsourcedIssue: vi.fn(),
  parseReferral: vi.fn(),
  recordAttribution: vi.fn(),
  checkRateLimit: vi.fn(),
  confirmReminderAppointment: vi.fn(),
  sendWhatsAppMessage: vi.fn(async () => undefined),
}))

// `after()` só funciona dentro de um request scope do Next — aqui ele vira uma
// fila, executada à mão depois da resposta.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => g.afterCallbacks.push(fn) }
})
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/llm/agent', () => ({
  processIncomingMessage: (...args: unknown[]) => g.processIncomingMessage(...args),
  handleUnsupportedMessage: (...args: unknown[]) => g.handleUnsupportedMessage(...args),
}))
vi.mock('@/lib/finance/agent', () => ({ processFinancialMessage: vi.fn(), sendFinanceReply: vi.fn() }))
vi.mock('@/lib/finance/respond', () => ({ buildUnsupportedTypeMessage: () => 'Só entendo texto.' }))
vi.mock('@/lib/whatsapp/send', () => ({ sendWhatsAppMessage: g.sendWhatsAppMessage }))
vi.mock('@/lib/crypto', () => ({
  decryptToken: (t: string) => t.replace(/^enc:/, ''),
  encryptToken: (t: string) => `enc:${t}`,
}))
vi.mock('@/lib/outsourced/clinic-reply', () => ({
  resolveClinicSender: g.resolveClinicSender,
  processClinicReplyMessage: g.processClinicReplyMessage,
}))
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue: g.notifyOutsourcedIssue }))
vi.mock('@/lib/whatsapp/referral', () => ({ parseReferral: g.parseReferral, recordAttribution: g.recordAttribution }))
vi.mock('@/lib/rate-limit/webhook', () => ({
  checkRateLimit: g.checkRateLimit,
  RATE_LIMIT_NOTICE_MESSAGE: 'Calma!',
}))
vi.mock('@/lib/whatsapp/confirm-appointment', () => ({ confirmReminderAppointment: g.confirmReminderAppointment }))

import { POST } from '@/app/api/whatsapp/webhook/route'

const SECRET = 'global-app-secret'
const PHONE_NUMBER_ID = 'pn-clinica-1'
const CLINIC_PHONE = '5571999990000'

function makeSignature(body: string) {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
}

function payload(message: Record<string, unknown>) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [message] } }] }],
  })
}

const TEXT_MSG = { from: CLINIC_PHONE, id: 'wamid.clinic', type: 'text', text: { body: 'CONSULTA AGENDADA' } }
const AUDIO_MSG = { from: CLINIC_PHONE, id: 'wamid.audio', type: 'audio', audio: { id: 'media1' } }

async function deliver(message: Record<string, unknown>) {
  const body = payload(message)
  const headers = new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': makeSignature(body) })
  const res = await POST(new Request('https://app.test/api/whatsapp/webhook', { method: 'POST', body, headers }) as never)
  const callbacks = [...g.afterCallbacks]
  g.afterCallbacks.length = 0
  for (const cb of callbacks) await cb()
  return res
}

function expectPatientFlowSkipped() {
  expect(g.parseReferral).not.toHaveBeenCalled()
  expect(g.recordAttribution).not.toHaveBeenCalled()
  expect(g.checkRateLimit).not.toHaveBeenCalled()
  expect(g.confirmReminderAppointment).not.toHaveBeenCalled()
  expect(g.processIncomingMessage).not.toHaveBeenCalled()
  expect(g.handleUnsupportedMessage).not.toHaveBeenCalled()
  expect(g.sendWhatsAppMessage).not.toHaveBeenCalled()
}

describe('POST /api/whatsapp/webhook — mensagem da clínica parceira', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({
      webhook_logs: { insert: { data: { id: 'log-1' } } },
      bot_config: { select: { data: { account_id: 'acc1', phone_number_id: PHONE_NUMBER_ID, meta_token: 'enc:tok' } } },
    })
    g.afterCallbacks = []
    g.processIncomingMessage = vi.fn(async () => undefined)
    g.handleUnsupportedMessage = vi.fn(async () => undefined)
    g.resolveClinicSender.mockReset().mockResolvedValue({ kind: 'none' })
    g.processClinicReplyMessage.mockReset().mockResolvedValue(undefined)
    g.notifyOutsourcedIssue.mockReset().mockResolvedValue(undefined)
    g.parseReferral.mockReset().mockReturnValue(null)
    g.recordAttribution.mockReset().mockResolvedValue(undefined)
    g.checkRateLimit.mockReset().mockResolvedValue({ allowed: true, shouldNotify: false })
    g.confirmReminderAppointment.mockReset().mockResolvedValue({ handled: false, reply: null })
    g.sendWhatsAppMessage.mockClear()
    process.env.META_APP_SECRET = SECRET
    delete process.env.FINANCE_PHONE_NUMBER_ID
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('número da clínica parceira → só processClinicReplyMessage, nenhum fluxo de paciente', async () => {
    g.resolveClinicSender.mockResolvedValue({ kind: 'match', workspaceId: 'w1' })

    const res = await deliver(TEXT_MSG)

    expect(res.status).toBe(200)
    expect(g.resolveClinicSender).toHaveBeenCalledWith(g.supabase.client, 'acc1', CLINIC_PHONE)
    expect(g.processClinicReplyMessage).toHaveBeenCalledWith({ accountId: 'acc1', workspaceId: 'w1', message: TEXT_MSG })
    expect(g.notifyOutsourcedIssue).not.toHaveBeenCalled()
    expectPatientFlowSkipped()
  })

  it('áudio da clínica parceira também nunca cai no fluxo de paciente', async () => {
    g.resolveClinicSender.mockResolvedValue({ kind: 'match', workspaceId: 'w1' })

    await deliver(AUDIO_MSG)

    expect(g.processClinicReplyMessage).toHaveBeenCalledWith({ accountId: 'acc1', workspaceId: 'w1', message: AUDIO_MSG })
    expectPatientFlowSkipped()
  })

  it('processClinicReplyMessage falhando não derruba o webhook nem cai no fluxo de paciente', async () => {
    g.resolveClinicSender.mockResolvedValue({ kind: 'match', workspaceId: 'w1' })
    g.processClinicReplyMessage.mockRejectedValue(new Error('boom'))

    const res = await deliver(TEXT_MSG)

    expect(res.status).toBe(200)
    expectPatientFlowSkipped()
  })

  it('mesmo número em duas unidades → aviso de configuração para cada uma e nada mais', async () => {
    g.resolveClinicSender.mockResolvedValue({ kind: 'conflict', workspaceIds: ['w1', 'w2'] })

    await deliver(TEXT_MSG)

    expect(g.notifyOutsourcedIssue).toHaveBeenCalledTimes(2)
    expect(g.notifyOutsourcedIssue).toHaveBeenCalledWith({ accountId: 'acc1', workspaceId: 'w1', reason: 'clinica_externa_config' })
    expect(g.notifyOutsourcedIssue).toHaveBeenCalledWith({ accountId: 'acc1', workspaceId: 'w2', reason: 'clinica_externa_config' })
    expect(g.processClinicReplyMessage).not.toHaveBeenCalled()
    expectPatientFlowSkipped()
  })

  it('número comum → fluxo de paciente intacto', async () => {
    await deliver({ ...TEXT_MSG, from: '5571988887777', text: { body: 'Oi' } })

    expect(g.processClinicReplyMessage).not.toHaveBeenCalled()
    expect(g.checkRateLimit).toHaveBeenCalledWith('acc1', '5571988887777')
    expect(g.processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc1', patientPhone: '5571988887777', message: 'Oi' })
    )
  })

  it('falha ao checar a clínica parceira → loga só ids, grava o erro no webhook_logs e não roda o fluxo de paciente', async () => {
    g.resolveClinicSender.mockRejectedValue(new Error('busca de unidades terceirizadas falhou account=acc1'))

    const res = await deliver({ ...TEXT_MSG, from: '5571988887777', text: { body: 'Oi' } })

    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalledWith('[outsourced] resolveClinicSender failed account=acc1')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/5571988887777|Oi/)
    const logUpdates = g.supabase.callsTo('webhook_logs', 'update')
    expect(logUpdates).toHaveLength(1)
    expect(logUpdates[0].payload).toEqual({ error: 'Error: busca de unidades terceirizadas falhou account=acc1' })
    expect(logUpdates[0].filters).toContainEqual(['eq', 'id', 'log-1'])
    expect(g.processClinicReplyMessage).not.toHaveBeenCalled()
    expect(g.notifyOutsourcedIssue).not.toHaveBeenCalled()
    expectPatientFlowSkipped()
  })

  it('isolamento: remetente com o telefone da Pituba vai para a Pituba, não para outra unidade', async () => {
    const actual = await vi.importActual<typeof import('@/lib/outsourced/clinic-reply')>('@/lib/outsourced/clinic-reply')
    g.resolveClinicSender.mockImplementation(actual.resolveClinicSender)
    g.supabase = createSupabaseMock({
      webhook_logs: { insert: { data: { id: 'log-1' } } },
      bot_config: { select: { data: { account_id: 'acc1', phone_number_id: PHONE_NUMBER_ID, meta_token: 'enc:tok' } } },
      workspaces: {
        select: {
          data: [
            { id: 'ws-barra', is_outsourced: true, external_clinic_phone: '5571911112222' },
            { id: 'ws-pituba', is_outsourced: true, external_clinic_phone: CLINIC_PHONE },
          ],
        },
      },
    })

    await deliver(TEXT_MSG)

    expect(g.processClinicReplyMessage).toHaveBeenCalledTimes(1)
    expect(g.processClinicReplyMessage).toHaveBeenCalledWith({ accountId: 'acc1', workspaceId: 'ws-pituba', message: TEXT_MSG })
    expectPatientFlowSkipped()
  })
})
