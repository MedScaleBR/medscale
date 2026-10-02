import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmReminderAppointment } from '@/lib/whatsapp/confirm-appointment'
import { createSupabaseMock } from '@/tests/helpers/supabase-mock'

const id = '11111111-1111-4111-8111-111111111111'
const message = { type: 'button', button: { payload: `confirm_appointment:${id}`, text: 'Confirmar consulta' } }
const appointment = { id, patient_phone: '+55 (11) 98888-7777', scheduled_at: '2026-10-03T14:00:00Z', status: 'agendado', reminder_sent: true }

describe('confirmação pelo botão do lembrete', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T14:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  it('confirma a consulta identificada pelo botão, verificando conta, paciente e status na atualização', async () => {
    const mock = createSupabaseMock({ appointments: { select: { data: appointment }, update: { data: [{ id }] } } })
    const result = await confirmReminderAppointment(mock.client as never, 'acc1', '5511988887777', message)
    expect(result.handled).toBe(true)
    expect(result.reply).toContain('confirmada')
    expect(mock.callsTo('appointments', 'select')[0].filters).toEqual(expect.arrayContaining([['eq', 'id', id], ['eq', 'account_id', 'acc1']]))
    const update = mock.callsTo('appointments', 'update')[0]
    expect(update.payload).toEqual({ status: 'confirmado' })
    expect(update.filters).toEqual(expect.arrayContaining([
      ['eq', 'id', id], ['eq', 'account_id', 'acc1'], ['eq', 'patient_phone', appointment.patient_phone],
      ['eq', 'status', 'agendado'], ['eq', 'reminder_sent', true], ['gt', 'scheduled_at', '2026-10-02T14:00:00.000Z'],
    ]))
  })

  it.each([
    ['outro paciente', { patient_phone: '5511999999999' }],
    ['cancelada', { status: 'cancelado' }],
    ['realizada', { status: 'realizado' }],
    ['no-show', { status: 'no_show' }],
    ['já confirmada', { status: 'confirmado' }],
    ['passada', { scheduled_at: '2026-10-01T14:00:00Z' }],
    ['sem lembrete', { reminder_sent: false }],
  ])('não altera consulta %s', async (_label, changes) => {
    const mock = createSupabaseMock({ appointments: { select: { data: { ...appointment, ...changes } } } })
    expect((await confirmReminderAppointment(mock.client as never, 'acc1', '5511988887777', message)).handled).toBe(true)
    expect(mock.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('não interpreta texto livre nem outros botões como confirmação', async () => {
    const mock = createSupabaseMock()
    for (const input of [{ type: 'text', text: { body: 'Confirmar consulta' } }, { type: 'button', button: { payload: 'outro' } }]) {
      expect((await confirmReminderAppointment(mock.client as never, 'acc1', '5511988887777', input)).handled).toBe(false)
    }
    expect(mock.calls).toHaveLength(0)
  })

  it('não anuncia sucesso quando outra atualização ganhou a corrida', async () => {
    const mock = createSupabaseMock({ appointments: { select: { data: appointment }, update: { data: [] } } })
    expect((await confirmReminderAppointment(mock.client as never, 'acc1', '5511988887777', message)).reply).not.toContain('confirmada')
  })

  it('propaga falhas do banco sem anunciar confirmação', async () => {
    const mock = createSupabaseMock({ appointments: { select: { data: appointment }, update: { error: { message: 'Unavailable' } } } })
    await expect(confirmReminderAppointment(mock.client as never, 'acc1', '5511988887777', message)).rejects.toThrow('Unavailable')
  })
})
