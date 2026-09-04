import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
const mirror = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/revenue/finance-mirror', () => ({ mirrorPaidRevenueToFinance: mirror }))

import {
  findTodayUnpaidByPatient,
  confirmAppointmentPayment,
  normalizeName,
} from '@/lib/finance/appointment-payment'

beforeEach(() => mirror.mockClear())

const ENTRY_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function withEntries(entries: unknown[]) {
  g.supabase = createSupabaseMock({
    workspaces: { select: { data: [{ id: 'w1' }] } },
    revenue_entries: { select: { data: entries }, update: { data: { id: ENTRY_ID } } },
  })
  return g.supabase
}

const row = (over: Record<string, unknown> = {}) => ({
  id: ENTRY_ID,
  amount: 350,
  procedure_name: 'Consulta de rotina',
  appointments: { scheduled_at: '2025-09-15T17:00:00.000Z', patient_name: 'João Silva' },
  patients: { full_name: 'João Silva' },
  ...over,
})

describe('normalizeName', () => {
  it('remove acento e caixa', () => {
    expect(normalizeName('  André JOÃO  ')).toBe('andre joao')
  })
})

describe('findTodayUnpaidByPatient', () => {
  it('casa pelo primeiro nome', async () => {
    withEntries([row()])
    const matches = await findTodayUnpaidByPatient(g.supabase.client as never, 'acc1', {
      patient: 'joao',
      time: null,
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ revenueEntryId: ENTRY_ID, patientName: 'João Silva', amount: 350 })
  })

  it('desempata pelo horário quando há mais de um', async () => {
    withEntries([
      row({ id: 'e1', appointments: { scheduled_at: '2025-09-15T17:00:00.000Z', patient_name: 'João Silva' } }),
      row({ id: 'e2', appointments: { scheduled_at: '2025-09-15T13:00:00.000Z', patient_name: 'João Souza' }, patients: { full_name: 'João Souza' } }),
    ])
    const matches = await findTodayUnpaidByPatient(g.supabase.client as never, 'acc1', {
      patient: 'joão',
      time: '14:00',
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].revenueEntryId).toBe('e1')
  })

  it('devolve vazio quando ninguém casa', async () => {
    withEntries([row()])
    const matches = await findTodayUnpaidByPatient(g.supabase.client as never, 'acc1', {
      patient: 'mariana',
      time: null,
    })
    expect(matches).toHaveLength(0)
  })

  it('filtra por due_date de hoje e payment_status em aberto', async () => {
    const supabase = withEntries([row()])
    await findTodayUnpaidByPatient(supabase.client as never, 'acc1', { patient: null, time: null })
    const call = supabase.callsTo('revenue_entries', 'select')[0]
    expect(filterValue(call!, 'in', 'payment_status')).toEqual(['pending', 'realized'])
  })
})

describe('confirmAppointmentPayment', () => {
  it('atualiza para paid/confirmado só se ainda estava em aberto', async () => {
    const supabase = withEntries([])
    const ok = await confirmAppointmentPayment(supabase.client as never, ENTRY_ID, 'pix')
    expect(ok).toBe(true)
    const update = supabase.callsTo('revenue_entries', 'update')[0]
    expect(update?.payload).toMatchObject({
      payment_status: 'paid',
      status: 'confirmado',
      payment_method: 'pix',
    })
    expect(filterValue(update!, 'in', 'payment_status')).toEqual(['pending', 'realized'])
  })

  it('retorna false quando o update não pega nenhuma linha', async () => {
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: [{ id: 'w1' }] } },
      revenue_entries: { update: { data: null } },
    })
    const ok = await confirmAppointmentPayment(g.supabase.client as never, ENTRY_ID, 'pix')
    expect(ok).toBe(false)
    expect(mirror).not.toHaveBeenCalled()
  })

  it('chama o espelho com os campos da linha atualizada quando confirma', async () => {
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: [{ id: 'w1' }] } },
      revenue_entries: {
        update: {
          data: {
            id: ENTRY_ID, account_id: 'a1', workspace_id: 'w1', amount: 350,
            procedure_name: 'Consulta de rotina', paid_at: '2026-09-04T12:00:00.000Z',
          },
        },
      },
    })
    const ok = await confirmAppointmentPayment(g.supabase.client as never, ENTRY_ID, 'pix')
    expect(ok).toBe(true)
    expect(mirror).toHaveBeenCalledWith(expect.anything(), {
      id: ENTRY_ID, accountId: 'a1', workspaceId: 'w1', amount: 350,
      procedureName: 'Consulta de rotina', paidAtIso: '2026-09-04T12:00:00.000Z',
    })
  })
})
