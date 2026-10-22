import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock, type SupabaseMockConfig, type RecordedCall } from '../helpers/supabase-mock'

const m = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  isGoogleConnected: vi.fn(),
  notifyOutsourcedIssue: vi.fn(),
  trackAppointmentBookedByBot: vi.fn(),
}))

vi.mock('@/lib/whatsapp/send', () => ({ sendTemplateMessage: m.sendTemplateMessage }))
vi.mock('@/lib/google/calendar', () => ({ createEvent: m.createEvent, deleteEvent: m.deleteEvent }))
vi.mock('@/lib/google/auth', () => ({ isGoogleConnected: m.isGoogleConnected }))
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue: m.notifyOutsourcedIssue }))
vi.mock('@/lib/analytics/posthog-server', () => ({ trackAppointmentBookedByBot: m.trackAppointmentBookedByBot }))

import { requestExternalConfirmation, type ExternalRequestInput } from '@/lib/outsourced/request'
import { buildSolicitacaoParams, renderSolicitacaoText } from '@/lib/outsourced/templates'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'

const SCHEDULED = new Date('2026-10-16T08:00:00-03:00')
const APPT = { id: 'ap-new', patient_name: 'Maria Souza', patient_phone: '5571988887777', type: 'consulta' }
const PENDING_ID = 'ap-old'

let supabase: SupabaseMock
let consoleSpies: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; log: ReturnType<typeof vi.spyOn> }

function setup(overrides: SupabaseMockConfig = {}) {
  supabase = createSupabaseMock({
    appointments: { select: { data: null }, insert: { data: { ...APPT } }, update: { data: null } },
    conversations: { update: { data: null } },
    waitlist: { update: { data: null } },
    clinic_confirmations: { insert: { data: null } },
    ...overrides,
  })
  return supabase
}

function input(over: Partial<ExternalRequestInput> = {}): ExternalRequestInput {
  return {
    supabase: supabase.client as unknown as ExternalRequestInput['supabase'],
    accountId: 'acc1',
    accountName: 'Clínica Teste',
    unit: { id: 'w1', name: 'IAD Pituba', externalClinicPhone: '5571999990000' },
    patient: { id: 'p1', fullName: 'Maria Souza', birthDate: '1980-05-03' },
    patientPhone: '5571988887777',
    conversationId: 'c1',
    scheduledAt: SCHEDULED,
    durationMin: 30,
    insurer: { id: 'ins1', name: 'Unimed' },
    procedure: null,
    replacingAppointmentId: null,
    phoneNumberId: 'pn-1',
    metaToken: 'tok',
    ...over,
  }
}

const pendingSelect = (call: RecordedCall) =>
  filterValue(call, 'neq', 'id') === PENDING_ID ? { data: null } : { data: { id: PENDING_ID } }

describe('requestExternalConfirmation', () => {
  beforeEach(() => {
    setup()
    m.sendTemplateMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.out' }] })
    m.createEvent.mockReset().mockResolvedValue({ id: 'ev1' })
    m.deleteEvent.mockReset().mockResolvedValue(undefined)
    m.isGoogleConnected.mockReset().mockResolvedValue({ connected: true, email: 'medico@clinica.com' })
    m.notifyOutsourcedIssue.mockReset().mockResolvedValue(undefined)
    m.trackAppointmentBookedByBot.mockReset().mockResolvedValue(undefined)
    consoleSpies = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    // LGPD: nenhum log carrega nome, nascimento ou telefone do paciente.
    expect(
      JSON.stringify([consoleSpies.error.mock.calls, consoleSpies.warn.mock.calls, consoleSpies.log.mock.calls])
    ).not.toMatch(/Maria|1980|98888/)
    vi.restoreAllMocks()
  })

  it('não cria outro pedido quando o paciente já tem pendente na unidade', async () => {
    setup({ appointments: { select: { data: { id: PENDING_ID } }, insert: { data: { ...APPT } } } })

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'already_pending' })
    const q = supabase.callsTo('appointments', 'select')[0]
    expect(filterValue(q, 'eq', 'workspace_id')).toBe('w1')
    expect(filterValue(q, 'eq', 'patient_id')).toBe('p1')
    expect(filterValue(q, 'eq', 'status')).toBe(PENDING_EXTERNAL_STATUS)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('ignora o pendente que está sendo cancelado na mesma resposta (remarcação)', async () => {
    setup({ appointments: { select: pendingSelect, insert: { data: { ...APPT } }, update: { data: null } } })

    const res = await requestExternalConfirmation(input({ replacingAppointmentId: PENDING_ID }))

    expect(filterValue(supabase.callsTo('appointments', 'select')[0], 'neq', 'id')).toBe(PENDING_ID)
    expect(res).toEqual({ kind: 'requested', appointmentId: 'ap-new' })
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
  })

  it('caminho feliz com convênio: pendente, evento provisório, template e registro', async () => {
    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'requested', appointmentId: 'ap-new' })

    const insert = supabase.callsTo('appointments', 'insert')[0].payload as Record<string, unknown>
    expect(insert).toMatchObject({
      workspace_id: 'w1',
      account_id: 'acc1',
      patient_id: 'p1',
      patient_name: 'Maria Souza',
      patient_phone: '5571988887777',
      scheduled_at: SCHEDULED.toISOString(),
      duration_min: 30,
      source: 'bot',
      status: PENDING_EXTERNAL_STATUS,
      billing_type: 'convenio',
      insurer_id: 'ins1',
      health_plan: 'Unimed',
    })
    expect(new Date(insert.external_requested_at as string).toISOString()).toBe(insert.external_requested_at)
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)

    const conv = supabase.callsTo('conversations', 'update')[0]
    expect(conv.payload).toEqual({ appointment_id: 'ap-new', workspace_id: 'w1' })
    expect(filterValue(conv, 'eq', 'id')).toBe('c1')

    const wl = supabase.callsTo('waitlist', 'update')[0]
    expect(wl.payload).toEqual({ status: 'scheduled' })
    expect(filterValue(wl, 'eq', 'workspace_id')).toBe('w1')
    expect(filterValue(wl, 'eq', 'patient_id')).toBe('p1')
    expect(filterValue(wl, 'eq', 'status')).toBe('waiting')

    expect(m.trackAppointmentBookedByBot).toHaveBeenCalledWith('acc1', {
      workspace_id: 'w1',
      account_id: 'acc1',
      slot_datetime: SCHEDULED.toISOString(),
    })

    expect(m.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', startTime: SCHEDULED, durationMin: 30, pending: true, doctorEmail: 'medico@clinica.com' })
    )
    const gcal = supabase
      .callsTo('appointments', 'update')
      .find((c) => (c.payload as { gcal_event_id?: string }).gcal_event_id !== undefined)
    expect(gcal?.payload).toEqual({ gcal_event_id: 'ev1' })

    const params = ['16/10', '08:00', 'Maria Souza', 'Unimed', '03/05/1980', '71 98888-7777']
    expect(m.sendTemplateMessage).toHaveBeenCalledWith({
      to: '5571999990000',
      phoneNumberId: 'pn-1',
      token: 'tok',
      templateName: 'solicitacao_agendamento',
      parameters: params,
    })

    expect(supabase.callsTo('clinic_confirmations', 'insert')[0].payload).toEqual({
      account_id: 'acc1',
      workspace_id: 'w1',
      appointment_id: 'ap-new',
      direction: 'outbound',
      raw_text: renderSolicitacaoText(params),
      whatsapp_id: 'wamid.out',
    })
    expect(m.notifyOutsourcedIssue).not.toHaveBeenCalled()
  })

  it('particular: snapshot do procedimento e "Particular" no template', async () => {
    await requestExternalConfirmation(
      input({ insurer: null, procedure: { id: 'proc1', name: 'Consulta', price: 300 } })
    )

    const insert = supabase.callsTo('appointments', 'insert')[0].payload as Record<string, unknown>
    expect(insert).toMatchObject({ procedure_id: 'proc1', procedure_name: 'Consulta', price: 300 })
    expect(insert).not.toHaveProperty('billing_type')
    expect(insert).not.toHaveProperty('insurer_id')
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)

    const expected = buildSolicitacaoParams({
      scheduledAt: SCHEDULED,
      patientName: 'Maria Souza',
      insuranceLabel: 'Particular',
      birthDate: '1980-05-03',
      patientPhone: '5571988887777',
    })
    expect(expected[3]).toBe('Particular')
    expect(m.sendTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({ parameters: expected }))
  })

  it('falha do Google não impede o template', async () => {
    m.createEvent.mockRejectedValueOnce(new Error('Google fora do ar'))

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'requested', appointmentId: 'ap-new' })
    expect(m.sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(consoleSpies.error).toHaveBeenCalledWith('[outsourced] gcal pendente falhou appointment=ap-new')
  })

  it('sem Google conectado não cria evento e segue com o template', async () => {
    m.isGoogleConnected.mockResolvedValueOnce({ connected: false, email: null })

    const res = await requestExternalConfirmation(input())

    expect(res.kind).toBe('requested')
    expect(m.createEvent).not.toHaveBeenCalled()
    expect(m.sendTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('envio do template falha: cancela, apaga o evento e avisa a equipe', async () => {
    m.sendTemplateMessage.mockRejectedValueOnce(new Error('WhatsApp API error: 400'))

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'send_failed', appointmentId: 'ap-new' })
    const cancel = supabase
      .callsTo('appointments', 'update')
      .find((c) => (c.payload as { status?: string }).status === 'cancelado')
    expect(cancel).toBeDefined()
    expect(filterValue(cancel!, 'eq', 'id')).toBe('ap-new')
    expect(m.deleteEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith({
      accountId: 'acc1',
      workspaceId: 'w1',
      appointmentId: 'ap-new',
      reason: 'clinica_externa_falha_envio',
    })
    expect(supabase.callsTo('clinic_confirmations', 'insert')).toHaveLength(0)
    // Pedido não saiu: paciente continua na lista de espera e nada vai para o analytics.
    expect(supabase.callsTo('waitlist', 'update')).toHaveLength(0)
    expect(m.trackAppointmentBookedByBot).not.toHaveBeenCalled()
  })

  it('loga só o id quando o cancelamento após falha de envio também falha', async () => {
    setup({ appointments: { select: { data: null }, insert: { data: { ...APPT } }, update: { data: null, error: { message: 'boom' } } } })
    m.sendTemplateMessage.mockRejectedValueOnce(new Error('WhatsApp API error: 400'))

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'send_failed', appointmentId: 'ap-new' })
    expect(consoleSpies.error).toHaveBeenCalledWith('[outsourced] cancel after send failure failed appointment=ap-new')
  })

  it.each([
    { phoneNumberId: null, metaToken: 'tok' },
    { phoneNumberId: 'pn-1', metaToken: null },
  ])('sem conexão WhatsApp ($phoneNumberId/$metaToken) trata como falha de envio', async (conn) => {
    m.isGoogleConnected.mockResolvedValueOnce({ connected: false, email: null })

    const res = await requestExternalConfirmation(input(conn))

    expect(res).toEqual({ kind: 'send_failed', appointmentId: 'ap-new' })
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()
    expect(m.deleteEvent).not.toHaveBeenCalled()
    expect(supabase.callsTo('appointments', 'update').some((c) => (c.payload as { status?: string }).status === 'cancelado')).toBe(true)
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'clinica_externa_falha_envio', appointmentId: 'ap-new' })
    )
    expect(supabase.callsTo('waitlist', 'update')).toHaveLength(0)
    expect(m.trackAppointmentBookedByBot).not.toHaveBeenCalled()
  })

  it('insert do appointment sem retorno → insert_failed, nada enviado', async () => {
    setup({ appointments: { select: { data: null }, insert: { data: null, error: { message: 'boom' } } } })

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'insert_failed' })
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()
    expect(m.createEvent).not.toHaveBeenCalled()
    expect(supabase.callsTo('conversations', 'update')).toHaveLength(0)
    // O paciente ouve "a equipe vai te retornar" — então a equipe é avisada.
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith({
      accountId: 'acc1',
      workspaceId: 'w1',
      appointmentId: null,
      reason: 'clinica_externa_falha_envio',
    })
  })

  it('falha ao gravar clinic_confirmations só loga — o pedido já saiu', async () => {
    setup({
      appointments: { select: { data: null }, insert: { data: { ...APPT } }, update: { data: null } },
      clinic_confirmations: { insert: { data: null, error: { message: 'boom' } } },
    })

    const res = await requestExternalConfirmation(input())

    expect(res).toEqual({ kind: 'requested', appointmentId: 'ap-new' })
    expect(consoleSpies.error).toHaveBeenCalled()
  })
})
