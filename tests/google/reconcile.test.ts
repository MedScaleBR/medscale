import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  listEvents: null as unknown as MockFn,
  googleConnected: true,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/google/calendar', () => ({ listEvents: (...args: unknown[]) => g.listEvents(...args) }))
vi.mock('@/lib/google/auth', () => ({
  isGoogleConnected: async () => ({ connected: g.googleConnected, email: 'medico@clinica.com' }),
}))

import { reconcileCalendar } from '@/lib/google/reconcile'

const FROM = new Date('2025-09-15T00:00:00-03:00')
const TO = new Date('2025-09-15T23:59:59-03:00')

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    workspace_id: 'w1',
    account_id: 'acc1',
    patient_name: 'João Silva',
    patient_phone: '5511988887777',
    scheduled_at: '2025-09-15T13:00:00.000Z',
    duration_min: 30,
    type: 'consulta',
    source: 'bot',
    status: 'agendado',
    gcal_event_id: 'gcal-1',
    ...overrides,
  }
}

/** Evento criado pela MedScale — reconhecido pela extendedProperty privada. */
function medscaleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gcal-1',
    summary: 'consulta — João Silva',
    description: 'Paciente: João Silva\nTelefone: 5511988887777',
    status: 'confirmed',
    start: { dateTime: '2025-09-15T10:00:00-03:00' },
    end: { dateTime: '2025-09-15T10:30:00-03:00' },
    extendedProperties: { private: { medscale: 'true' } },
    ...overrides,
  }
}

/** Compromisso pessoal do médico — sem a marca da MedScale. */
function personalEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pessoal-1',
    summary: 'Almoço com a família',
    status: 'confirmed',
    start: { dateTime: '2025-09-15T12:00:00-03:00' },
    end: { dateTime: '2025-09-15T13:00:00-03:00' },
    ...overrides,
  }
}

function setup(rows: unknown[], events: unknown[], config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    appointments: {
      select: { data: rows },
      update: { data: null },
      upsert: { data: null },
    },
    workspaces: { select: { data: { account_id: 'acc1' } } },
    ...config,
  })
  g.listEvents = vi.fn(async () => events)
  return g.supabase
}

describe('reconcileCalendar — sincronização inversa Google → Supabase', () => {
  beforeEach(() => {
    g.googleConnected = true
  })

  it('deve ignorar evento do Google sem a marca extendedProperties.private.medscale', async () => {
    const supabase = setup([], [personalEvent()])
    const result = await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'upsert')).toHaveLength(0)
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
    // Continua aparecendo como bloqueio de agenda, sem virar consulta.
    expect(result.busyBlocks).toEqual([
      { start: '2025-09-15T12:00:00-03:00', end: '2025-09-15T13:00:00-03:00', summary: 'Almoço com a família' },
    ])
  })

  it('deve marcar o appointment como cancelado quando o evento MedScale está cancelled no Google', async () => {
    const supabase = setup(
      [appointmentRow()],
      [medscaleEvent({ status: 'cancelled' })],
      { appointments: { select: { data: [appointmentRow()] }, update: { data: appointmentRow({ status: 'cancelado' }) } } }
    )
    await reconcileCalendar('w1', FROM, TO)

    const update = supabase.callsTo('appointments', 'update')[0]
    expect(update?.payload).toEqual({ status: 'cancelado' })
    expect(update?.filters).toContainEqual(['eq', 'id', 'appt-1'])
  })

  it('não deve sobrescrever um appointment com status realizado', async () => {
    const supabase = setup([appointmentRow({ status: 'realizado' })], [medscaleEvent({ status: 'cancelled' })])
    await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('não deve sobrescrever um appointment com status no_show', async () => {
    const supabase = setup([appointmentRow({ status: 'no_show' })], [medscaleEvent({ status: 'cancelled' })])
    await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('não deve criar consulta fantasma quando o evento MedScale já não tem linha no Supabase', async () => {
    // Evento cancelado no Google e sem linha correspondente: nada a fazer.
    const supabase = setup([], [medscaleEvent({ status: 'cancelled' })])
    await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'upsert')).toHaveLength(0)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
  })

  it('deve importar como consulta o evento MedScale ativo que não tem linha no Supabase', async () => {
    const supabase = setup([], [medscaleEvent()], {
      appointments: {
        select: { data: [] },
        update: { data: null },
        upsert: { data: appointmentRow({ source: 'importado' }) },
      },
    })
    const result = await reconcileCalendar('w1', FROM, TO)

    const upsert = supabase.callsTo('appointments', 'upsert')[0]
    expect(upsert?.payload).toMatchObject({
      workspace_id: 'w1',
      account_id: 'acc1',
      patient_name: 'João Silva',
      patient_phone: '5511988887777',
      source: 'importado',
      gcal_event_id: 'gcal-1',
      duration_min: 30,
    })
    expect(result.appointments).toHaveLength(1)
  })

  it('deve atualizar horário e duração quando o evento foi movido no Google', async () => {
    const supabase = setup(
      [appointmentRow()],
      [
        medscaleEvent({
          start: { dateTime: '2025-09-15T15:00:00-03:00' },
          end: { dateTime: '2025-09-15T16:00:00-03:00' },
        }),
      ]
    )
    await reconcileCalendar('w1', FROM, TO)

    const update = supabase.callsTo('appointments', 'update')[0]
    expect(update?.payload).toEqual({ scheduled_at: '2025-09-15T18:00:00.000Z', duration_min: 60 })
  })

  it('não deve escrever nada quando o evento continua igual ao registro', async () => {
    const supabase = setup([appointmentRow()], [medscaleEvent()])
    await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('deve cancelar a linha cujo evento sumiu da busca no Google', async () => {
    const supabase = setup([appointmentRow({ gcal_event_id: 'gcal-apagado' })], [])
    await reconcileCalendar('w1', FROM, TO)

    const update = supabase.callsTo('appointments', 'update')[0]
    expect(update?.payload).toEqual({ status: 'cancelado' })
  })

  it('não deve cancelar linha sem gcal_event_id quando ela não está no Google', async () => {
    // Consulta criada só na MedScale, sem calendário sincronizado.
    const supabase = setup([appointmentRow({ gcal_event_id: null })], [])
    await reconcileCalendar('w1', FROM, TO)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('deve devolver só o Supabase quando a workspace não tem Google conectado', async () => {
    g.googleConnected = false
    setup([appointmentRow()], [])
    const result = await reconcileCalendar('w1', FROM, TO)

    expect(result.googleConnected).toBe(false)
    expect(result.busyBlocks).toEqual([])
    expect(result.appointments).toHaveLength(1)
    expect(g.listEvents).not.toHaveBeenCalled()
  })

  it('deve degradar para o Supabase quando a leitura do Google falha', async () => {
    setup([appointmentRow()], [])
    g.listEvents = vi.fn(async () => {
      throw new Error('token revogado')
    })
    const result = await reconcileCalendar('w1', FROM, TO)

    expect(result.googleConnected).toBe(true)
    expect(result.appointments).toHaveLength(1)
    expect(result.busyBlocks).toEqual([])
  })

  it('deve ignorar compromisso pessoal cancelado ao montar os bloqueios', async () => {
    setup([], [personalEvent({ status: 'cancelled' })])
    const result = await reconcileCalendar('w1', FROM, TO)

    expect(result.busyBlocks).toEqual([])
  })

  it('deve buscar as consultas dentro do intervalo pedido', async () => {
    const supabase = setup([], [])
    await reconcileCalendar('w1', FROM, TO)

    const select = supabase.callsTo('appointments', 'select')[0]
    expect(select.filters).toContainEqual(['gte', 'scheduled_at', FROM.toISOString()])
    expect(select.filters).toContainEqual(['lte', 'scheduled_at', TO.toISOString()])
    expect(select.filters).toContainEqual(['eq', 'workspace_id', 'w1'])
  })
})
