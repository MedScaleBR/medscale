import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  listEvents: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/google/calendar', () => ({ listEvents: (...args: unknown[]) => g.listEvents(...args) }))

import { getAvailableSlots, getFreeSlotsByDayForBot, isSlotAvailable } from '@/lib/google/availability'

// Âncora: terça 11/11/2025. Quinzenal: 11/11, 25/11, 09/12...
const BIWEEKLY = { day_of_week: 2, start_time: '08:00', end_time: '09:00', slot_duration: 30, interval_weeks: 2, anchor_date: '2025-11-11' }
const WEEKLY_THU = { day_of_week: 4, start_time: '14:00', end_time: '15:00', slot_duration: 30, interval_weeks: 1, anchor_date: null }

function setup(rules: unknown[], exceptions: unknown[] = [], openUntil: string | null = null) {
  g.supabase = createSupabaseMock({
    workspaces: { select: { data: { booking_open_until: openUntil } } },
    availability_rules: { select: { data: rules } },
    availability_exceptions: { select: { data: exceptions } },
    appointments: { select: { data: [] } },
  })
  g.listEvents = vi.fn(async () => [])
}

describe('disponibilidade com repetição', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-11-12T12:00:00-03:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.BOT_SLOTS_LOOKAHEAD_DAYS
  })

  it('getAvailableSlots: quinzenal só gera slots nas terças certas', async () => {
    setup([BIWEEKLY])
    expect(await getAvailableSlots('w1', new Date('2025-11-25T12:00:00-03:00'))).toHaveLength(2)
    expect(await getAvailableSlots('w1', new Date('2025-11-18T12:00:00-03:00'))).toEqual([])
  })

  it('isSlotAvailable recusa a terça da semana errada', async () => {
    setup([BIWEEKLY])
    expect(await isSlotAvailable('w1', new Date('2025-11-25T08:00:00-03:00'), 30)).toBe(true)
    expect(await isSlotAvailable('w1', new Date('2025-11-18T08:00:00-03:00'), 30)).toBe(false)
  })

  it('a Clara acha a próxima terça a 13 dias (antes a janela de 12 dias escondia)', async () => {
    setup([BIWEEKLY])
    const byDay = await getFreeSlotsByDayForBot('w1', new Date(), { maxDays: 4 })
    expect(Object.keys(byDay)).toEqual(['2025-11-25', '2025-12-09'])
    expect(byDay['2025-11-25']).toEqual(['08:00', '08:30'])
  })

  it('uma única leitura do Google Calendar para o período inteiro', async () => {
    setup([BIWEEKLY, WEEKLY_THU])
    await getFreeSlotsByDayForBot('w1', new Date(), { maxDays: 4 })
    expect(g.listEvents).toHaveBeenCalledTimes(1)
    const [, from, to] = g.listEvents.mock.calls[0] as unknown as [string, Date, Date]
    expect(from.getTime()).toBe(new Date('2025-11-13T03:00:00.000Z').getTime())
    expect(to.getTime()).toBeGreaterThan(new Date('2025-12-09T00:00:00-03:00').getTime())
  })

  it('para em 4 dias com vaga e respeita BOT_SLOTS_LOOKAHEAD_DAYS', async () => {
    setup([WEEKLY_THU])
    expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date()))).toEqual([
      '2025-11-13',
      '2025-11-20',
      '2025-11-27',
      '2025-12-04',
    ])
    process.env.BOT_SLOTS_LOOKAHEAD_DAYS = '10'
    setup([BIWEEKLY])
    expect(await getFreeSlotsByDayForBot('w1', new Date())).toEqual({})
  })

  it('dia quinzenal bloqueado: pula para o seguinte; extra abre um dia fora da regra', async () => {
    setup(
      [BIWEEKLY],
      [
        { date: '2025-11-25', type: 'blocked', start_time: null, end_time: null },
        { date: '2025-11-29', type: 'extra', start_time: '10:00', end_time: '10:30' },
      ]
    )
    const byDay = await getFreeSlotsByDayForBot('w1', new Date())
    expect(Object.keys(byDay)).toEqual(['2025-11-29', '2025-12-09'])
    const [exceptionsQuery] = g.supabase.callsTo('availability_exceptions', 'select')
    expect(filterValue(exceptionsQuery, 'gte', 'date')).toBe('2025-11-13')
    expect(filterValue(exceptionsQuery, 'lte', 'date')).toBe('2025-12-17')
  })

  it('regras sem as colunas novas (migration pendente) valem toda semana', async () => {
    setup([{ day_of_week: 2, start_time: '08:00', end_time: '08:30', slot_duration: 30 }])
    expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date(), { maxDays: 2 }))).toEqual(['2025-11-18', '2025-11-25'])
  })

  describe('agenda aberta até', () => {
    it('a Clara não oferece dias depois do limite', async () => {
      setup([WEEKLY_THU], [], '2025-11-27')
      expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date()))).toEqual(['2025-11-13', '2025-11-20', '2025-11-27'])
    })

    it('dia bloqueado dentro do limite também fica de fora', async () => {
      setup([WEEKLY_THU], [{ date: '2025-11-20', type: 'blocked', start_time: null, end_time: null }], '2025-11-27')
      expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date()))).toEqual(['2025-11-13', '2025-11-27'])
    })

    it('limite passado: nenhuma vaga, sem ler o Google', async () => {
      setup([WEEKLY_THU], [], '2025-11-10')
      expect(await getFreeSlotsByDayForBot('w1', new Date())).toEqual({})
      expect(g.listEvents).not.toHaveBeenCalled()
    })

    it('openUntil passado pela unidade evita a leitura e null é sem limite', async () => {
      setup([WEEKLY_THU], [], '2025-11-13')
      expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date(), { openUntil: null }))).toHaveLength(4)
      expect(g.supabase.callsTo('workspaces')).toHaveLength(0)
    })

    it('isSlotAvailable recusa depois do limite; a agenda da equipe enxerga tudo', async () => {
      setup([WEEKLY_THU], [], '2025-11-20')
      expect(await isSlotAvailable('w1', new Date('2025-11-20T14:00:00-03:00'), 30)).toBe(true)
      expect(await isSlotAvailable('w1', new Date('2025-11-27T14:00:00-03:00'), 30)).toBe(false)
      expect(await getAvailableSlots('w1', new Date('2025-11-27T12:00:00-03:00'))).toHaveLength(2)
      expect(await getAvailableSlots('w1', new Date('2025-11-27T12:00:00-03:00'), { forPatient: true })).toEqual([])
    })

    it('coluna ausente (migration pendente): sem limite', async () => {
      setup([WEEKLY_THU])
      g.supabase = createSupabaseMock({
        workspaces: { select: { data: null, error: { message: 'column does not exist' } } },
        availability_rules: { select: { data: [WEEKLY_THU] } },
        availability_exceptions: { select: { data: [] } },
        appointments: { select: { data: [] } },
      })
      expect(Object.keys(await getFreeSlotsByDayForBot('w1', new Date()))).toHaveLength(4)
    })
  })
})
