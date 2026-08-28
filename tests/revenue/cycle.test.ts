import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))

import {
  syncRevenueEntryToAppointmentStatus,
  createBookingRevenueEntry,
  applyAppointmentRevenue,
  revenueStatusToPaymentStatus,
  saoPauloDateOnly,
} from '@/lib/revenue/cycle'

const APPT = 'a1b2c3d4-0000-0000-0000-000000000001'

function mock(config = {}) {
  g.supabase = createSupabaseMock(config)
  return g.supabase
}

describe('syncRevenueEntryToAppointmentStatus', () => {
  it('move para "realized" quando a consulta foi realizada — só entradas pending', async () => {
    const supabase = mock()

    await syncRevenueEntryToAppointmentStatus(supabase.client as never, APPT, 'realizado')

    const update = supabase.callsTo('revenue_entries', 'update')[0]
    expect(update?.payload).toEqual({ payment_status: 'realized' })
    expect(filterValue(update!, 'in', 'appointment_id')).toEqual([APPT])
    expect(filterValue(update!, 'eq', 'payment_status')).toBe('pending')
  })

  it('move para "cancelled" em no_show e em cancelado', async () => {
    for (const status of ['no_show', 'cancelado'] as const) {
      const supabase = mock()
      await syncRevenueEntryToAppointmentStatus(supabase.client as never, APPT, status)
      const update = supabase.callsTo('revenue_entries', 'update')[0]
      expect(update?.payload).toEqual({ payment_status: 'cancelled' })
    }
  })

  it('não faz nada para status não-terminais (agendado/confirmado)', async () => {
    const supabase = mock()
    await syncRevenueEntryToAppointmentStatus(supabase.client as never, APPT, 'confirmado')
    expect(supabase.callsTo('revenue_entries', 'update')).toHaveLength(0)
  })

  it('aceita lista de ids e não faz update quando a lista está vazia', async () => {
    const supabase = mock()
    await syncRevenueEntryToAppointmentStatus(supabase.client as never, [APPT, 'x'], 'realizado')
    expect(filterValue(supabase.callsTo('revenue_entries', 'update')[0]!, 'in', 'appointment_id')).toEqual([APPT, 'x'])

    const empty = mock()
    await syncRevenueEntryToAppointmentStatus(empty.client as never, [], 'realizado')
    expect(empty.callsTo('revenue_entries', 'update')).toHaveLength(0)
  })
})

describe('createBookingRevenueEntry', () => {
  const base = {
    workspaceId: 'w1',
    accountId: 'acc1',
    appointmentId: APPT,
    patientId: 'p1',
    procedureId: null,
    procedureName: null,
    scheduledAt: '2025-09-15T17:00:00.000Z',
    source: 'bot' as const,
  }

  it('não insere nada quando não há preço conhecido', async () => {
    const supabase = mock()
    await createBookingRevenueEntry(supabase.client as never, { ...base, amount: null })
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('accounts', 'select')).toHaveLength(0)
  })

  it('não insere quando o módulo revenue_cycle está inativo na account', async () => {
    const supabase = mock({ accounts: { select: { data: { modules: ['dashboard', 'agenda'] } } } })
    await createBookingRevenueEntry(supabase.client as never, { ...base, amount: 350 })
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
  })

  it('não insere quando já existe revenue_entry para o appointment (idempotente)', async () => {
    const supabase = mock({
      accounts: { select: { data: { modules: ['revenue_cycle'] } } },
      revenue_entries: { select: { data: { id: 're-1' } } },
    })
    await createBookingRevenueEntry(supabase.client as never, { ...base, amount: 350 })
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
  })

  it('insere a entrada PREVISTA/pending com snapshots e due_date no fuso de SP', async () => {
    const supabase = mock({
      accounts: { select: { data: { modules: ['revenue_cycle'] } } },
      revenue_entries: { select: { data: null } },
    })
    await createBookingRevenueEntry(supabase.client as never, {
      ...base,
      amount: 350,
      procedureId: 'proc-1',
      procedureName: 'Consulta de rotina',
    })

    const insert = supabase.callsTo('revenue_entries', 'insert')[0]
    expect(insert?.payload).toMatchObject({
      workspace_id: 'w1',
      account_id: 'acc1',
      appointment_id: APPT,
      patient_id: 'p1',
      procedure_id: 'proc-1',
      procedure_name: 'Consulta de rotina',
      amount: 350,
      status: 'previsto',
      payment_status: 'pending',
      source: 'bot',
      due_date: '2025-09-15',
      entry_date: '2025-09-15',
    })
  })
})

describe('applyAppointmentRevenue', () => {
  const booking = {
    workspaceId: 'w1',
    accountId: 'acc1',
    appointmentId: APPT,
    patientId: 'p1',
    procedureId: null,
    procedureName: null,
    amount: 400,
    scheduledAt: '2025-09-15T17:00:00.000Z',
    source: 'manual' as const,
  }

  const revenueCycleOn = {
    accounts: { select: { data: { modules: ['revenue_cycle'] } } },
    revenue_entries: { select: { data: null } },
  }

  it('cria a entrada e já promove para "realized" quando valor e "realizado" entram na mesma gravação', async () => {
    const supabase = mock(revenueCycleOn)

    await applyAppointmentRevenue(supabase.client as never, {
      booking,
      previousStatus: 'agendado',
      nextStatus: 'realizado',
    })

    const insert = supabase.callsTo('revenue_entries', 'insert')[0]
    const update = supabase.callsTo('revenue_entries', 'update')[0]
    expect(insert?.payload).toMatchObject({ payment_status: 'pending', amount: 400 })
    expect(update?.payload).toEqual({ payment_status: 'realized' })
    // A entrada precisa ser inserida ANTES do sync — que só age em linhas 'pending'.
    expect(supabase.calls.indexOf(insert!)).toBeLessThan(supabase.calls.indexOf(update!))
  })

  it('só cria a previsão (sem sincronizar) quando apenas o preço muda e o status fica igual', async () => {
    const supabase = mock(revenueCycleOn)

    await applyAppointmentRevenue(supabase.client as never, {
      booking,
      previousStatus: 'agendado',
      nextStatus: 'agendado',
    })

    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(1)
    expect(supabase.callsTo('revenue_entries', 'update')).toHaveLength(0)
  })

  it('não cria entrada ao cancelar — apenas move a existente para "cancelled"', async () => {
    const supabase = mock()

    await applyAppointmentRevenue(supabase.client as never, {
      booking,
      previousStatus: 'agendado',
      nextStatus: 'cancelado',
    })

    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('accounts', 'select')).toHaveLength(0)
    expect(supabase.callsTo('revenue_entries', 'update')[0]?.payload).toEqual({ payment_status: 'cancelled' })
  })

  it('sincroniza o status sem tentar criar entrada quando não há preço conhecido', async () => {
    const supabase = mock()

    await applyAppointmentRevenue(supabase.client as never, {
      booking: { ...booking, amount: null },
      previousStatus: 'confirmado',
      nextStatus: 'realizado',
    })

    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('accounts', 'select')).toHaveLength(0)
    expect(supabase.callsTo('revenue_entries', 'update')[0]?.payload).toEqual({ payment_status: 'realized' })
  })
})

describe('revenueStatusToPaymentStatus', () => {
  it('traduz os 3 estados do lançamento avulso para o payment_status canônico', () => {
    expect(revenueStatusToPaymentStatus('previsto')).toBe('pending')
    expect(revenueStatusToPaymentStatus('confirmado')).toBe('paid')
    expect(revenueStatusToPaymentStatus('cancelado')).toBe('cancelled')
  })
})

describe('saoPauloDateOnly', () => {
  it('resolve a data no fuso de São Paulo, não em UTC', () => {
    // 02:00Z de 16/09 ainda é 15/09 23:00 em São Paulo (-03:00).
    expect(saoPauloDateOnly('2025-09-16T02:00:00.000Z')).toBe('2025-09-15')
  })
})
