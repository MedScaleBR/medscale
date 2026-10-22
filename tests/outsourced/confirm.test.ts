import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const m = vi.hoisted(() => ({
  supabase: null as unknown as { client: unknown },
  sendWhatsAppMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  markEventConfirmed: vi.fn(),
  applyAppointmentRevenue: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => m.supabase.client }))
vi.mock('@/lib/whatsapp/send', () => ({
  sendWhatsAppMessage: m.sendWhatsAppMessage,
  sendTemplateMessage: m.sendTemplateMessage,
}))
vi.mock('@/lib/google/calendar', () => ({ markEventConfirmed: m.markEventConfirmed }))
vi.mock('@/lib/revenue/cycle', () => ({ applyAppointmentRevenue: m.applyAppointmentRevenue }))
// Token guardado criptografado no banco — o prefixo "enc:" imita isso.
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => t.replace(/^enc:/, '') }))

import { confirmOutsourcedAppointment } from '@/lib/outsourced/confirm'
import { confirmedMessage } from '@/lib/outsourced/messages'
import { buildConsultaConfirmadaParams, TEMPLATE_CONSULTA_CONFIRMADA } from '@/lib/outsourced/templates'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'

const NOW = new Date('2026-10-08T15:00:00.000Z')
const SCHEDULED = '2026-10-09T12:00:00.000Z'

const APPT = {
  id: 'ap1',
  workspace_id: 'w1',
  account_id: 'acc1',
  patient_id: 'p1',
  patient_name: 'Marilene Ribeiro',
  patient_phone: '5571988887777',
  scheduled_at: SCHEDULED,
  status: 'confirmado',
  procedure_id: 'proc1',
  procedure_name: 'Consulta',
  price: 300,
  health_plan: null,
  gcal_event_id: 'ev1',
}
const UNIT = { name: 'IAD Pituba', address: 'Rua das Flores, 10', city: 'Salvador', state: 'BA' }
const BOT = { phone_number_id: 'pn-1', meta_token: 'enc:tok' }

let supabase: SupabaseMock
let consoleSpies: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; log: ReturnType<typeof vi.spyOn> }

function setup(overrides: SupabaseMockConfig = {}) {
  supabase = createSupabaseMock({
    appointments: { update: { data: { ...APPT } } },
    workspaces: { select: { data: { ...UNIT } } },
    bot_config: { select: { data: { ...BOT } } },
    conversations: { select: { data: { id: 'c1' } } },
    // Última mensagem do paciente há 2h — janela de 24h aberta.
    messages: { select: { data: { sent_at: new Date(NOW.getTime() - 2 * 3600_000).toISOString() } }, insert: { data: null } },
    ...overrides,
  })
  m.supabase = supabase
  return supabase
}

const expectedText = (address: string | null = 'Rua das Flores, 10, Salvador, BA') =>
  confirmedMessage({ scheduledAt: new Date(SCHEDULED), unitName: 'IAD Pituba', address })

describe('confirmOutsourcedAppointment', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(NOW)
    setup()
    m.sendWhatsAppMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.txt' }] })
    m.sendTemplateMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.tpl' }] })
    m.markEventConfirmed.mockReset().mockResolvedValue(undefined)
    m.applyAppointmentRevenue.mockReset().mockResolvedValue(undefined)
    consoleSpies = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    // LGPD: nenhum log carrega nome ou telefone do paciente.
    expect(
      JSON.stringify([consoleSpies.error.mock.calls, consoleSpies.warn.mock.calls, consoleSpies.log.mock.calls])
    ).not.toMatch(/Marilene|98888/)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('só confirma quem ainda está pendente: update condicional por id e status', async () => {
    await confirmOutsourcedAppointment('ap1')

    const upd = supabase.callsTo('appointments', 'update')[0]
    expect(upd.payload).toEqual({ status: 'confirmado' })
    expect(filterValue(upd, 'eq', 'id')).toBe('ap1')
    expect(filterValue(upd, 'eq', 'status')).toBe(PENDING_EXTERNAL_STATUS)
    expect(upd.filters.some((f) => f[0] === 'select')).toBe(true)
  })

  it('sem linha atualizada → not_pending e nenhum efeito', async () => {
    setup({ appointments: { update: { data: null } } })

    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: false, reason: 'not_pending' })
    expect(m.applyAppointmentRevenue).not.toHaveBeenCalled()
    expect(m.markEventConfirmed).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()
    expect(supabase.callsTo('messages')).toHaveLength(0)
  })

  it('confirma: receita prevista, Google confirmado e texto livre dentro da janela de 24h', async () => {
    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: true, appointmentId: 'ap1' })

    expect(m.applyAppointmentRevenue).toHaveBeenCalledTimes(1)
    const [, revenue] = m.applyAppointmentRevenue.mock.calls[0]
    expect(revenue).toMatchObject({
      previousStatus: PENDING_EXTERNAL_STATUS,
      nextStatus: 'confirmado',
      booking: { appointmentId: 'ap1', workspaceId: 'w1', accountId: 'acc1', amount: 300, scheduledAt: SCHEDULED },
    })

    expect(m.markEventConfirmed).toHaveBeenCalledWith('w1', 'ev1')

    const conv = supabase.callsTo('conversations', 'select')[0]
    expect(filterValue(conv, 'eq', 'account_id')).toBe('acc1')
    expect(filterValue(conv, 'eq', 'patient_phone')).toBe('5571988887777')
    const last = supabase.callsTo('messages', 'select')[0]
    expect(filterValue(last, 'eq', 'conversation_id')).toBe('c1')
    expect(filterValue(last, 'eq', 'role')).toBe('user')

    expect(m.sendWhatsAppMessage).toHaveBeenCalledWith({
      to: '5571988887777',
      message: expectedText(),
      phoneNumberId: 'pn-1',
      token: 'tok',
    })
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()

    expect(supabase.callsTo('messages', 'insert')[0].payload).toMatchObject({
      conversation_id: 'c1',
      role: 'assistant',
      content: expectedText(),
    })
  })

  it('última mensagem do paciente há mais de 24h → template consulta_confirmada', async () => {
    setup({
      messages: { select: { data: { sent_at: new Date(NOW.getTime() - 25 * 3600_000).toISOString() } }, insert: { data: null } },
    })

    await confirmOutsourcedAppointment('ap1')

    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.sendTemplateMessage).toHaveBeenCalledWith({
      to: '5571988887777',
      phoneNumberId: 'pn-1',
      token: 'tok',
      templateName: TEMPLATE_CONSULTA_CONFIRMADA,
      parameters: buildConsultaConfirmadaParams({
        patientName: 'Marilene Ribeiro',
        scheduledAt: new Date(SCHEDULED),
        unitName: 'IAD Pituba',
      }),
    })
    expect(TEMPLATE_CONSULTA_CONFIRMADA).toBe('consulta_confirmada')
    expect(supabase.callsTo('messages', 'insert')[0].payload).toMatchObject({
      conversation_id: 'c1',
      role: 'assistant',
      content: expectedText(),
    })
  })

  it('sem mensagem do paciente → template', async () => {
    setup({ messages: { select: { data: null }, insert: { data: null } } })

    await confirmOutsourcedAppointment('ap1')

    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.sendTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('unidade sem endereço → endereço null na mensagem', async () => {
    setup({ workspaces: { select: { data: { name: 'IAD Pituba', address: null, city: '', state: null } } } })

    await confirmOutsourcedAppointment('ap1')

    expect(m.sendWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expectedText(null) }))
  })

  it('endereço só com cidade e estado', async () => {
    setup({ workspaces: { select: { data: { name: 'IAD Pituba', address: null, city: 'Salvador', state: 'BA' } } } })

    await confirmOutsourcedAppointment('ap1')

    expect(m.sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: expectedText('Salvador, BA') })
    )
  })

  it('sem evento no Google → não chama markEventConfirmed', async () => {
    setup({ appointments: { update: { data: { ...APPT, gcal_event_id: null } } } })

    await confirmOutsourcedAppointment('ap1')

    expect(m.markEventConfirmed).not.toHaveBeenCalled()
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('falha do Google não desfaz o confirmado nem impede o aviso ao paciente', async () => {
    m.markEventConfirmed.mockRejectedValue(new Error('google down'))

    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: true, appointmentId: 'ap1' })
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(1)
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('falha do envio não desfaz o confirmado e não lança', async () => {
    m.sendWhatsAppMessage.mockRejectedValue(new Error('meta down'))

    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: true, appointmentId: 'ap1' })
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(1)
    // Não registra no histórico uma mensagem que o paciente não recebeu.
    expect(supabase.callsTo('messages', 'insert')).toHaveLength(0)
  })

  it('falha da receita não desfaz o confirmado e não lança', async () => {
    m.applyAppointmentRevenue.mockRejectedValue(new Error('db'))

    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: true, appointmentId: 'ap1' })
    expect(m.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('WhatsApp da account não conectado → confirma sem enviar', async () => {
    setup({ bot_config: { select: { data: { phone_number_id: null, meta_token: null } } } })

    const res = await confirmOutsourcedAppointment('ap1')

    expect(res).toEqual({ ok: true, appointmentId: 'ap1' })
    expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(m.sendTemplateMessage).not.toHaveBeenCalled()
  })
})
