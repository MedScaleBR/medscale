// Repetição do expediente (availability_rules.interval_weeks / anchor_date).
// Única fonte da decisão "esta regra vale nesta data": usada no cálculo de
// disponibilidade, na revalidação antes de gravar, no prompt da Clara e na
// prévia da tela. Arquivo puro — não importa nada de servidor.
//
// Datas são AAAA-MM-DD já resolvidas em America/Sao_Paulo. A conta é feita
// sobre o número do dia no calendário (Date.UTC só como contador de dias),
// nunca com Date em hora local, que viraria o dia ao cruzar UTC.

export interface RecurrenceRule {
  /** 0=domingo … 6=sábado. */
  day_of_week: number
  /** 1 = toda semana; 2 a 4 = a cada N semanas. Ausente/null = 1. */
  interval_weeks?: number | null
  /** Um dia em que a regra vale. Obrigatório com interval_weeks > 1. */
  anchor_date?: string | null
}

export interface RecurrenceException {
  date: string
  type: string
  start_time?: string | null
}

export const INTERVAL_WEEKS_OPTIONS = [1, 2, 3, 4] as const

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** Número do dia (dias desde 1970-01-01) de uma data pura; null se inválida. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  return ms / MS_PER_DAY
}

function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Soma dias a uma data pura. */
export function addDaysToDate(date: string, days: number): string {
  const n = dayNumber(date)
  if (n === null) throw new Error(`data inválida: ${date}`)
  return fromDayNumber(n + days)
}

/** Dia da semana (0=domingo) de uma data pura. 01/01/1970 foi quinta (4). */
export function weekdayOfDate(date: string): number {
  const n = dayNumber(date)
  if (n === null) throw new Error(`data inválida: ${date}`)
  return (((n + 4) % 7) + 7) % 7
}

function intervalOf(rule: RecurrenceRule): number {
  return rule.interval_weeks && rule.interval_weeks > 1 ? rule.interval_weeks : 1
}

/** A regra vale nesta data? */
export function ruleAppliesOn(rule: RecurrenceRule, date: string): boolean {
  const n = dayNumber(date)
  if (n === null) return false
  if ((((n + 4) % 7) + 7) % 7 !== rule.day_of_week) return false
  const interval = intervalOf(rule)
  if (interval === 1) return true
  const anchor = rule.anchor_date ? dayNumber(rule.anchor_date) : null
  // Âncora ausente/inválida numa regra repetida: não dá para saber a semana — não vale.
  if (anchor === null) return false
  const weeks = (n - anchor) / 7
  if (!Number.isInteger(weeks)) return false
  return ((weeks % interval) + interval) % interval === 0
}

/** Dia inteiro bloqueado (exceção 'blocked' sem horário). */
function isFullDayBlock(e: RecurrenceException): boolean {
  return e.type === 'blocked' && !e.start_time
}

/**
 * Próximas `count` datas, a partir de `from` (inclusive) e olhando até
 * `maxDays` dias, em que alguma regra vale ou há exceção 'extra' — tirando os
 * dias bloqueados inteiros.
 */
export function nextRuleDates(
  rules: readonly RecurrenceRule[],
  exceptions: readonly RecurrenceException[],
  from: string,
  count: number,
  maxDays: number
): string[] {
  const start = dayNumber(from)
  if (start === null || count <= 0) return []
  const blocked = new Set(exceptions.filter(isFullDayBlock).map((e) => e.date))
  const extras = new Set(exceptions.filter((e) => e.type === 'extra').map((e) => e.date))
  const out: string[] = []
  for (let i = 0; i < maxDays && out.length < count; i++) {
    const date = fromDayNumber(start + i)
    if (blocked.has(date)) continue
    if (extras.has(date) || rules.some((r) => ruleAppliesOn(r, date))) out.push(date)
  }
  return out
}

/** Valida a repetição de uma regra (API e tela). Devolve o motivo, ou null. */
export function recurrenceProblem(input: {
  day_of_week: number
  interval_weeks: unknown
  anchor_date: unknown
}): string | null {
  const interval = input.interval_weeks ?? 1
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 4) {
    return 'A repetição precisa ser de 1 a 4 semanas.'
  }
  if (interval === 1) return null
  if (typeof input.anchor_date !== 'string' || dayNumber(input.anchor_date) === null) {
    return 'Informe um dia em que o atendimento acontece.'
  }
  if (weekdayOfDate(input.anchor_date) !== input.day_of_week) {
    return 'O dia informado precisa cair no mesmo dia da semana da regra.'
  }
  return null
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAY_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados']

/** "a cada 2 semanas" (ou "toda semana"). */
export function intervalLabel(interval: number | null | undefined): string {
  const n = interval && interval > 1 ? interval : 1
  return n === 1 ? 'toda semana' : `a cada ${n} semanas`
}

/** Advérbio para o prompt: "quinzenalmente", "a cada 3 semanas". */
export function intervalAdverb(interval: number | null | undefined): string {
  const n = interval && interval > 1 ? interval : 1
  if (n === 1) return 'toda semana'
  if (n === 2) return 'quinzenalmente'
  return `a cada ${n} semanas`
}

export function weekdayPlural(day: number): string {
  return WEEKDAY_PLURAL[day] ?? ''
}

/** "ter 11/11" */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_SHORT[weekdayOfDate(date)]} ${d}/${m}`
}

/** "11/11" */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}
