// Período do painel de custos a partir da URL: os atalhos de 7/30/90 dias
// ("últimas N×24h", como sempre foi) ou um dia/intervalo escolhido no
// calendário, em dias de São Paulo. Puro, sem Supabase — testável.
//
// Fica fora de cost-alerts.ts de propósito: queue.ts importa cost-alerts, e
// este módulo não pode depender de nenhum dos dois sem criar ciclo.

export const COST_PERIODS = [7, 30, 90] as const
export const DEFAULT_COST_DAYS = 30
/** Teto do intervalo personalizado — protege o MAX_EVENTS da consulta. */
export const MAX_CUSTOM_DAYS = 366

const TZ = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000
// São Paulo é UTC−3 fixo (sem horário de verão desde 2019).
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

export type CostWindow =
  | { kind: 'days'; days: number; since: string; until: null }
  | { kind: 'custom'; from: string; to: string; since: string; until: string }

export type CalendarPreset = 'hoje' | 'ontem' | 'esta_semana' | 'este_mes' | 'mes_passado'

export function normalizeCostDays(value: string | number | null | undefined): number {
  const n = Number(value)
  return COST_PERIODS.includes(n as (typeof COST_PERIODS)[number]) ? n : DEFAULT_COST_DAYS
}

/** YYYY-MM-DD do instante em São Paulo. */
function spDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** 00:00 de São Paulo do dia, em ms UTC. */
function startOfSpDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + BRT_OFFSET_MS
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

function isValidDay(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

export function windowFromDays(days: number, now: Date = new Date()): CostWindow {
  return { kind: 'days', days, since: new Date(now.getTime() - days * DAY_MS).toISOString(), until: null }
}

function customWindow(from: string, to: string): CostWindow {
  return {
    kind: 'custom',
    from,
    to,
    since: new Date(startOfSpDay(from)).toISOString(),
    until: new Date(startOfSpDay(addDays(to, 1))).toISOString(),
  }
}

export function parseCostWindow(
  params: { days?: string; from?: string; to?: string },
  now: Date = new Date(),
): CostWindow {
  const { from, to } = params
  if (isValidDay(from) && isValidDay(to)) {
    const today = spDate(now)
    const span = daysInclusive(from, to)
    if (from <= to && to <= today && span <= MAX_CUSTOM_DAYS) return customWindow(from, to)
    return windowFromDays(DEFAULT_COST_DAYS, now)
  }
  return windowFromDays(normalizeCostDays(params.days), now)
}

export function windowDayCount(w: CostWindow): number {
  return w.kind === 'days' ? w.days : daysInclusive(w.from, w.to)
}

export function isSingleDay(w: CostWindow): boolean {
  return w.kind === 'custom' && w.from === w.to
}

/** Intervalo de mesmo tamanho imediatamente antes — o "vs. período anterior". */
export function previousWindow(w: CostWindow, now: Date = new Date()): { since: string; until: string } {
  if (w.kind === 'days') {
    return {
      since: new Date(now.getTime() - 2 * w.days * DAY_MS).toISOString(),
      until: new Date(now.getTime() - w.days * DAY_MS).toISOString(),
    }
  }
  const span = windowDayCount(w)
  return { since: new Date(startOfSpDay(addDays(w.from, -span))).toISOString(), until: w.since }
}

export function costWindowQuery(w: CostWindow): Record<string, string> {
  return w.kind === 'days' ? { days: String(w.days) } : { from: w.from, to: w.to }
}

export function presetRange(p: CalendarPreset, now: Date = new Date()): { from: string; to: string } {
  const today = spDate(now)
  switch (p) {
    case 'hoje':
      return { from: today, to: today }
    case 'ontem': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'esta_semana': {
      // Semana começa no domingo, como a primeira coluna do calendário.
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
      return { from: addDays(today, -weekday), to: today }
    }
    case 'este_mes':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'mes_passado': {
      const firstThisMonth = `${today.slice(0, 7)}-01`
      const lastPrev = addDays(firstThisMonth, -1)
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev }
    }
  }
}

/**
 * "vs. período anterior" só faz sentido com dias completos: um intervalo que
 * termina hoje compararia um dia pela metade com um dia cheio do anterior.
 * Os atalhos 7/30/90 são janelas de N×24h, então comparam o mesmo tamanho.
 */
export function showPeriodChange(w: CostWindow, today: string): boolean {
  return w.kind === 'days' || w.to < today
}
