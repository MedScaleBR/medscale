import { describe, it, expect } from 'vitest'
import { appointmentTypeLabel, classifyAppointmentType, resolveBotAppointmentType } from '@/lib/appointment-type'
import { createSupabaseMock } from './helpers/supabase-mock'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const NEW = new Date('2026-11-10T13:00:00Z')
const daysBefore = (n: number) => new Date(NEW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('classifyAppointmentType', () => {
  it('sem histórico é primeira consulta', () => {
    expect(classifyAppointmentType([], NEW)).toBe('consulta')
  })

  it('consulta realizada até 30 dias antes é retorno', () => {
    expect(classifyAppointmentType([{ scheduled_at: daysBefore(10), status: 'realizado' }], NEW)).toBe('retorno')
    expect(classifyAppointmentType([{ scheduled_at: daysBefore(30), status: 'realizado' }], NEW)).toBe('retorno')
  })

  it('última realizada há mais de 30 dias: não marca nada', () => {
    expect(classifyAppointmentType([{ scheduled_at: daysBefore(31), status: 'realizado' }], NEW)).toBeNull()
  })

  it('usa a realizada mais recente', () => {
    const past = [
      { scheduled_at: daysBefore(200), status: 'realizado' as const },
      { scheduled_at: daysBefore(5), status: 'realizado' as const },
    ]
    expect(classifyAppointmentType(past, NEW)).toBe('retorno')
  })

  it('consulta passada sem desfecho (agendada/confirmada): não marca nada', () => {
    expect(classifyAppointmentType([{ scheduled_at: daysBefore(3), status: 'agendado' }], NEW)).toBeNull()
    expect(classifyAppointmentType([{ scheduled_at: daysBefore(3), status: 'confirmado' }], NEW)).toBeNull()
  })

  it('cancelada e falta não contam como atendimento', () => {
    const past = [
      { scheduled_at: daysBefore(3), status: 'cancelado' as const },
      { scheduled_at: daysBefore(4), status: 'no_show' as const },
    ]
    expect(classifyAppointmentType(past, NEW)).toBe('consulta')
  })
})

describe('resolveBotAppointmentType', () => {
  const client = (mock: ReturnType<typeof createSupabaseMock>) => mock.client as unknown as SupabaseClient<Database>
  const now = new Date('2026-11-01T12:00:00Z')

  it('busca só consultas passadas do paciente na account', async () => {
    const mock = createSupabaseMock({ appointments: { select: { data: [{ scheduled_at: daysBefore(10), status: 'realizado' }] } } })
    const type = await resolveBotAppointmentType(client(mock), { accountId: 'acc1', patientId: 'p1', scheduledAt: NEW, now })
    expect(type).toBe('retorno')
    const filters = mock.callsTo('appointments', 'select')[0].filters
    expect(filters).toContainEqual(['eq', 'account_id', 'acc1'])
    expect(filters).toContainEqual(['eq', 'patient_id', 'p1'])
    expect(filters).toContainEqual(['lt', 'scheduled_at', now.toISOString()])
  })

  it('erro ao ler o histórico: não marca nada', async () => {
    const mock = createSupabaseMock({ appointments: { select: { data: null, error: { message: 'boom' } } } })
    expect(await resolveBotAppointmentType(client(mock), { accountId: 'acc1', patientId: 'p1', scheduledAt: NEW, now })).toBeNull()
  })

  it('paciente ainda sem cadastro é primeira consulta, sem consultar o banco', async () => {
    const mock = createSupabaseMock({})
    expect(await resolveBotAppointmentType(client(mock), { accountId: 'acc1', patientId: null, scheduledAt: NEW, now })).toBe('consulta')
    expect(mock.callsTo('appointments')).toHaveLength(0)
  })
})

describe('appointmentTypeLabel', () => {
  it('tipo vazio aparece como "Não definido"', () => {
    expect(appointmentTypeLabel(null)).toBe('Não definido')
    expect(appointmentTypeLabel('retorno')).toBe('Retorno')
  })
})
