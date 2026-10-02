import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getDashboardStats } from '@/lib/dashboard'
import { createSupabaseMock } from '@/tests/helpers/supabase-mock'

vi.mock('@/lib/revenue/dashboard-forecast', () => ({ getDashboardForecast: vi.fn(async () => null) }))

afterEach(() => vi.useRealTimers())

describe('consultas pendentes de confirmação no dashboard', () => {
  it('consulta apenas agendadas nas próximas 24 horas das unidades selecionadas, inclusive na virada do mês', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T18:00:00Z'))
    const pending = [{ id: 'a1', patient_name: 'Ana', scheduled_at: '2026-11-01T12:00:00Z', workspace_id: 'w1' }]
    const mock = createSupabaseMock({
      appointments: { select: (call) => ({
        data: call.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'agendado') ? pending : [],
      }) },
    })
    const stats = await getDashboardStats(mock.client as unknown as SupabaseClient<Database>, ['w1', 'w2'])
    expect(stats.pendingConfirmations).toEqual(pending)
    const query = mock.callsTo('appointments').find((call) => call.filters.some(([method, column, value]) => method === 'eq' && column === 'status' && value === 'agendado'))
    expect(query?.filters).toEqual(expect.arrayContaining([
      ['in', 'workspace_id', ['w1', 'w2']],
      ['eq', 'status', 'agendado'],
      ['gte', 'scheduled_at', '2026-10-31T18:00:00.000Z'],
      ['lte', 'scheduled_at', '2026-11-01T18:00:00.000Z'],
      ['order', 'scheduled_at'],
    ]))
  })

  it('distingue falha na consulta de uma lista sem pendências', async () => {
    const failed = createSupabaseMock({ appointments: { select: { data: null, error: { message: 'Unavailable' } } } })
    const empty = createSupabaseMock({ appointments: { select: { data: [], error: null } } })
    expect((await getDashboardStats(failed.client as unknown as SupabaseClient<Database>, ['w1'])).pendingConfirmations).toBeNull()
    expect((await getDashboardStats(empty.client as unknown as SupabaseClient<Database>, ['w1'])).pendingConfirmations).toEqual([])
  })
})
