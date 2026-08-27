import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  listEvents: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/google/calendar', () => ({
  listEvents: (...args: unknown[]) => g.listEvents(...args),
}))

import { getAvailableSlots, getFreeSlotsForBot, isSlotAvailable } from '@/lib/google/availability'

const WORKSPACE = 'w1'
// Segunda-feira, 15/09/2025 — a data usada em todos os cenários.
const MONDAY = new Date('2025-09-15T12:00:00-03:00')
const SATURDAY = new Date('2025-09-20T12:00:00-03:00')

interface Scenario {
  rules?: Array<{ start_time: string; end_time: string; slot_duration: number }>
  exceptions?: Array<{ type: string; start_time: string | null; end_time: string | null }>
  appointments?: Array<{ scheduled_at: string; duration_min: number }>
  events?: unknown[]
  eventsError?: Error
}

function setup(scenario: Scenario) {
  const config: SupabaseMockConfig = {
    availability_rules: { select: { data: scenario.rules ?? [] } },
    availability_exceptions: { select: { data: scenario.exceptions ?? [] } },
    appointments: { select: { data: scenario.appointments ?? [] } },
  }
  g.supabase = createSupabaseMock(config)
  g.listEvents = vi.fn(async () => {
    if (scenario.eventsError) throw scenario.eventsError
    return scenario.events ?? []
  })
  return g.supabase
}

/** Evento do Google Calendar no fuso de São Paulo. */
function gcalEvent(startISO: string, endISO: string, status = 'confirmed') {
  return { id: `ev-${startISO}`, status, start: { dateTime: startISO }, end: { dateTime: endISO } }
}

const MANHA = [{ start_time: '08:00', end_time: '12:00', slot_duration: 30 }]

describe('getAvailableSlots — cálculo de disponibilidade', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Segunda-feira, 12h no horário de São Paulo. Nenhum teste desta suite
    // pode depender do relógio real — o resultado mudaria a cada execução.
    vi.setSystemTime(new Date('2025-09-15T12:00:00-03:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve retornar array vazio quando não há nenhuma availability_rules', async () => {
    setup({ rules: [] })
    expect(await getAvailableSlots(WORKSPACE, MONDAY)).toEqual([])
  })

  it('deve gerar 8 slots de 30min quando a regra é segunda das 8h às 12h e o Google não tem eventos', async () => {
    setup({ rules: MANHA })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
  })

  it('deve consultar as regras do dia da semana correto (segunda = 1)', async () => {
    const supabase = setup({ rules: MANHA })
    await getAvailableSlots(WORKSPACE, MONDAY)
    const call = supabase.callsTo('availability_rules', 'select')[0]
    expect(call.filters).toContainEqual(['eq', 'day_of_week', 1])
    expect(call.filters).toContainEqual(['eq', 'is_active', true])
  })

  it('deve remover o slot das 09:00 quando há evento no Google Calendar nesse horário', async () => {
    setup({ rules: MANHA, events: [gcalEvent('2025-09-15T09:00:00-03:00', '2025-09-15T09:30:00-03:00')] })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).not.toContain('09:00')
    expect(slots).toContain('08:30')
    expect(slots).toContain('09:30')
  })

  it('deve ignorar evento do Google marcado como cancelled', async () => {
    setup({
      rules: MANHA,
      events: [gcalEvent('2025-09-15T09:00:00-03:00', '2025-09-15T09:30:00-03:00', 'cancelled')],
    })
    expect(await getFreeSlotsForBot(WORKSPACE, MONDAY)).toContain('09:00')
  })

  it('deve remover todos os slots cobertos por um evento longo do Google', async () => {
    setup({ rules: MANHA, events: [gcalEvent('2025-09-15T09:00:00-03:00', '2025-09-15T11:00:00-03:00')] })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).toEqual(['08:00', '08:30', '11:00', '11:30'])
  })

  it('deve retornar array vazio quando há availability_exception bloqueando o dia inteiro', async () => {
    setup({ rules: MANHA, exceptions: [{ type: 'blocked', start_time: null, end_time: null }] })
    expect(await getAvailableSlots(WORKSPACE, MONDAY)).toEqual([])
  })

  it('deve remover apenas a faixa bloqueada quando a exception tem horário', async () => {
    setup({ rules: MANHA, exceptions: [{ type: 'blocked', start_time: '09:00', end_time: '10:00' }] })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).toEqual(['08:00', '08:30', '10:00', '10:30', '11:00', '11:30'])
  })

  it('deve retornar os slots do horário extra mesmo sem availability_rules para aquele dia (sábado)', async () => {
    setup({ rules: [], exceptions: [{ type: 'extra', start_time: '09:00', end_time: '11:00' }] })
    const slots = await getFreeSlotsForBot(WORKSPACE, SATURDAY)
    expect(slots).toEqual(['09:00', '09:30', '10:00', '10:30'])
  })

  it('não deve duplicar horários quando um extra se sobrepõe a uma regra existente', async () => {
    setup({ rules: MANHA, exceptions: [{ type: 'extra', start_time: '11:00', end_time: '13:00' }] })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'])
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('deve remover o slot das 10:00 quando já existe consulta agendada no Supabase nesse horário', async () => {
    setup({
      rules: MANHA,
      appointments: [{ scheduled_at: '2025-09-15T10:00:00-03:00', duration_min: 30 }],
    })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).not.toContain('10:00')
    expect(slots).toContain('09:30')
    expect(slots).toContain('10:30')
  })

  it('deve considerar apenas consultas ativas ao bloquear slots', async () => {
    const supabase = setup({ rules: MANHA })
    await getAvailableSlots(WORKSPACE, MONDAY)
    const call = supabase.callsTo('appointments', 'select')[0]
    expect(call.filters).toContainEqual(['in', 'status', ['agendado', 'confirmado']])
  })

  it('deve degradar para as availability_rules quando o Google Calendar retorna 401', async () => {
    setup({ rules: MANHA, eventsError: Object.assign(new Error('Invalid Credentials'), { code: 401 }) })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).toHaveLength(8)
  })

  it('deve continuar bloqueando consultas do Supabase mesmo com o Google fora do ar', async () => {
    setup({
      rules: MANHA,
      appointments: [{ scheduled_at: '2025-09-15T08:00:00-03:00', duration_min: 30 }],
      eventsError: new Error('token expirado'),
    })
    const slots = await getFreeSlotsForBot(WORKSPACE, MONDAY)
    expect(slots).not.toContain('08:00')
    expect(slots).toHaveLength(7)
  })

  it('deve retornar slots normalmente quando a workspace não tem o calendário conectado', async () => {
    setup({ rules: MANHA, eventsError: new Error('Google Calendar não conectado para esta workspace') })
    await expect(getFreeSlotsForBot(WORKSPACE, MONDAY)).resolves.toHaveLength(8)
  })

  it('deve respeitar o fuso America/Sao_Paulo mesmo com o processo em UTC', async () => {
    // Uma regra de 08:00–12:00 cadastrada em São Paulo gera slots de 08:00 a
    // 11:30 no horário de Brasília — nunca 11:00–15:00 em UTC.
    setup({ rules: MANHA })
    const slots = await getAvailableSlots(WORKSPACE, MONDAY)

    const first = new TZDate(slots[0].start, 'America/Sao_Paulo')
    expect(first.getHours()).toBe(8)
    expect(first.getMinutes()).toBe(0)

    const last = new TZDate(slots.at(-1)!.start, 'America/Sao_Paulo')
    expect(last.getHours()).toBe(11)
    expect(last.getMinutes()).toBe(30)

    // O instante absoluto correspondente é 11:00 UTC (BRT = UTC-3).
    expect(new Date(slots[0].start).toISOString()).toBe('2025-09-15T11:00:00.000Z')
  })

  it('deve calcular o dia certo quando o servidor em UTC já virou a data', async () => {
    // 15/09 23:30 em São Paulo = 16/09 02:30 UTC. O dia da semana consultado
    // tem que continuar sendo segunda (1), não terça.
    vi.setSystemTime(new Date('2025-09-16T02:30:00Z'))
    const supabase = setup({ rules: MANHA })
    await getAvailableSlots(WORKSPACE, new Date('2025-09-15T23:30:00-03:00'))

    const rulesCall = supabase.callsTo('availability_rules', 'select')[0]
    expect(rulesCall.filters).toContainEqual(['eq', 'day_of_week', 1])
    const exceptionsCall = supabase.callsTo('availability_exceptions', 'select')[0]
    expect(exceptionsCall.filters).toContainEqual(['eq', 'date', '2025-09-15'])
  })

  it('deve respeitar slot_duration diferente de 30 minutos', async () => {
    setup({ rules: [{ start_time: '08:00', end_time: '09:00', slot_duration: 20 }] })
    expect(await getFreeSlotsForBot(WORKSPACE, MONDAY)).toEqual(['08:00', '08:20', '08:40'])
  })

  it('não deve gerar slot que ultrapasse o fim da janela', async () => {
    setup({ rules: [{ start_time: '08:00', end_time: '08:45', slot_duration: 30 }] })
    expect(await getFreeSlotsForBot(WORKSPACE, MONDAY)).toEqual(['08:00'])
  })

  it('deve unir duas regras do mesmo dia em ordem cronológica', async () => {
    setup({
      rules: [
        { start_time: '14:00', end_time: '15:00', slot_duration: 30 },
        { start_time: '08:00', end_time: '09:00', slot_duration: 30 },
      ],
    })
    expect(await getFreeSlotsForBot(WORKSPACE, MONDAY)).toEqual(['08:00', '08:30', '14:00', '14:30'])
  })
})

describe('isSlotAvailable — revalidação no momento da confirmação', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-09-15T12:00:00-03:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve retornar true quando o horário exato está entre os slots livres', async () => {
    setup({ rules: MANHA })
    expect(await isSlotAvailable(WORKSPACE, new Date('2025-09-15T10:00:00-03:00'), 30)).toBe(true)
  })

  it('deve retornar false quando o horário foi ocupado por um evento do Google', async () => {
    setup({ rules: MANHA, events: [gcalEvent('2025-09-15T10:00:00-03:00', '2025-09-15T10:30:00-03:00')] })
    expect(await isSlotAvailable(WORKSPACE, new Date('2025-09-15T10:00:00-03:00'), 30)).toBe(false)
  })

  it('deve retornar false quando o horário foi ocupado por outra consulta no Supabase', async () => {
    setup({ rules: MANHA, appointments: [{ scheduled_at: '2025-09-15T10:00:00-03:00', duration_min: 30 }] })
    expect(await isSlotAvailable(WORKSPACE, new Date('2025-09-15T10:00:00-03:00'), 30)).toBe(false)
  })

  it('deve retornar false para um horário que não existe na grade (ex: 10:15)', async () => {
    setup({ rules: MANHA })
    expect(await isSlotAvailable(WORKSPACE, new Date('2025-09-15T10:15:00-03:00'), 30)).toBe(false)
  })

  it('deve retornar false quando o dia inteiro está bloqueado por exceção', async () => {
    setup({ rules: MANHA, exceptions: [{ type: 'blocked', start_time: null, end_time: null }] })
    expect(await isSlotAvailable(WORKSPACE, new Date('2025-09-15T10:00:00-03:00'), 30)).toBe(false)
  })
})
