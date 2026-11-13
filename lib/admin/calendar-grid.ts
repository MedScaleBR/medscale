import { MAX_CUSTOM_DAYS } from '@/lib/admin/cost-range'

// Lógica pura do calendário do filtro de custos: grade do mês e seleção de um
// dia ou de um intervalo. Datas sempre como YYYY-MM-DD (dia de São Paulo).

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export type RangeDraft = { start: string | null; end: string | null }
export type DayState = 'start' | 'end' | 'single' | 'in' | 'future' | 'today' | 'normal'

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** Semanas de domingo a sábado; null nas casas fora do mês. */
export function monthGrid(year: number, month0: number): (string | null)[][] {
  const first = Date.UTC(year, month0, 1)
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array(new Date(first).getUTCDay()).fill(null)
  for (let d = 0; d < daysInMonth; d++) cells.push(iso(first + d * DAY_MS))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** 1º clique marca o início; 2º fecha o intervalo (em ordem); 3º recomeça. */
export function clickDay(draft: RangeDraft, day: string): RangeDraft {
  if (!draft.start || draft.end) return { start: day, end: null }
  return day < draft.start ? { start: day, end: draft.start } : { start: draft.start, end: day }
}

export function draftToRange(d: RangeDraft): { from: string; to: string } | null {
  if (!d.start) return null
  return { from: d.start, to: d.end ?? d.start }
}

export function dayState(day: string, d: RangeDraft, today: string): DayState {
  if (day > today) return 'future'
  if (d.start && !d.end && day === d.start) return 'single'
  if (d.start && d.end) {
    if (day === d.start && day === d.end) return 'single'
    if (day === d.start) return 'start'
    if (day === d.end) return 'end'
    if (day > d.start && day < d.end) return 'in'
  }
  return day === today ? 'today' : 'normal'
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

export function draftTooLong(d: RangeDraft): boolean {
  const r = draftToRange(d)
  return r ? spanDays(r.from, r.to) > MAX_CUSTOM_DAYS : false
}

function shortDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`
}

/** Rodapé do calendário: "3 nov – 11 nov · 9 dias" ou "11 nov · 1 dia". */
export function rangeLabel(r: { from: string; to: string }): string {
  const n = spanDays(r.from, r.to)
  const days = `${n} ${n === 1 ? 'dia' : 'dias'}`
  return r.from === r.to ? `${shortDay(r.from)} · ${days}` : `${shortDay(r.from)} – ${shortDay(r.to)} · ${days}`
}

/** Botão do filtro: "11/11" ou "03/11 – 11/11". */
export function buttonLabel(r: { from: string; to: string }): string {
  const f = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`
}
