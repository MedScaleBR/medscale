import { TZDate } from '@date-fns/tz'
import {
  addDaysToDate,
  formatDayMonth,
  formatShortDate,
  intervalAdverb,
  nextRuleDates,
  ruleAppliesOn,
  weekdayPlural,
  type RecurrenceRule,
} from '@/lib/scheduling/recurrence'

// Dias da semana em que a unidade atende, tirados do expediente
// (availability_rules) e das datas avulsas abertas (availability_exceptions
// do tipo 'extra'). Vale para toda unidade, inclusive a de agenda externa:
// lá a Clara não tem os horários, mas sabe em que dias o doutor atende.

export interface UnitWorkingDays {
  /** 0=domingo … 6=sábado, em ordem. Vazio/ausente = expediente não cadastrado. */
  workingDays?: number[]
  /** Datas avulsas (AAAA-MM-DD) em que a unidade abre fora dos dias fixos. */
  extraDates?: string[]
  /** Regras do expediente com a repetição. Ausente = só os dias da semana valem. */
  scheduleRules?: ScheduleRule[]
  /** Dias bloqueados inteiros à frente (AAAA-MM-DD). */
  blockedDates?: string[]
  /** Último dia (AAAA-MM-DD) em que a agenda está aberta. null/ausente = sem limite. */
  bookingOpenUntil?: string | null
}

/** A data está dentro da agenda aberta da unidade (sem limite = sempre). */
export function isBookingOpen(unit: UnitWorkingDays, date: string): boolean {
  return !unit.bookingOpenUntil || date <= unit.bookingOpenUntil
}

/** Dia bloqueado inteiro (feriado, férias etc.). */
export function isBlockedDate(unit: UnitWorkingDays, date: string): boolean {
  return (unit.blockedDates ?? []).includes(date)
}

export interface ScheduleRule extends RecurrenceRule {
  start_time: string
  end_time: string
}

/** Alguma regra da unidade repete a cada 2 semanas ou mais. */
export function hasSpacedRule(unit: UnitWorkingDays): boolean {
  return (unit.scheduleRules ?? []).some((r) => (r.interval_weeks ?? 1) > 1)
}

/** "terças, quinzenalmente, 08:00–12:00; quintas, 14:00–18:00" */
export function describeSchedule(rules: readonly ScheduleRule[]): string {
  return [...rules]
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
    .map((r) => {
      const every = (r.interval_weeks ?? 1) > 1 ? `, ${intervalAdverb(r.interval_weeks)}` : ''
      return `${weekdayPlural(r.day_of_week)}${every}, ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`
    })
    .join('; ')
}

/** Próximas datas de atendimento a partir do dia seguinte a `today` (AAAA-MM-DD). */
export function upcomingAttendanceDates(unit: UnitWorkingDays, today: string, count = 3, maxDays = 60): string[] {
  const exceptions = [
    ...(unit.extraDates ?? []).map((date) => ({ date, type: 'extra' })),
    ...(unit.blockedDates ?? []).map((date) => ({ date, type: 'blocked', start_time: null })),
  ]
  // Só datas dentro da agenda aberta.
  return nextRuleDates(unit.scheduleRules ?? [], exceptions, addDaysToDate(today, 1), count, maxDays).filter((d) =>
    isBookingOpen(unit, d)
  )
}

const WEEKDAY_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados']
const WEEKDAY_NAME = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

/** A unidade tem expediente cadastrado — sem ele, não dá para afirmar nada. */
export function hasWorkingDays(unit: UnitWorkingDays): boolean {
  return (unit.workingDays?.length ?? 0) > 0
}

/** "segunda-feira e terça-feira" */
export function formatWorkingDays(days: number[]): string {
  return joinPt(days.map((d) => WEEKDAY_NAME[d]))
}

/** "segundas e terças" — para frases como "atende às segundas e terças". */
export function formatWorkingDaysPlural(days: number[]): string {
  return joinPt(days.map((d) => WEEKDAY_PLURAL[d]))
}

/** Dia da semana (0–6) de uma data AAAA-MM-DD, no fuso de São Paulo. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new TZDate(y, m - 1, d, 12, 0, 0, 'America/Sao_Paulo').getDay()
}

/**
 * A unidade atende nesta data? Sem expediente cadastrado responde true: a
 * Clara não bloqueia o que não sabe.
 */
export function attendsOn(unit: UnitWorkingDays, date: string): boolean {
  // Dia bloqueado inteiro vale mais que expediente e data avulsa.
  if (isBlockedDate(unit, date)) return false
  if (!hasWorkingDays(unit)) return true
  if ((unit.extraDates ?? []).includes(date)) return true
  // Com as regras carregadas, a repetição decide (terça da semana "errada" não vale).
  if (unit.scheduleRules?.length) return unit.scheduleRules.some((r) => ruleAppliesOn(r, date))
  return unit.workingDays!.includes(weekdayOf(date))
}

/** Mensagem fixa quando a Clara tentou marcar num dia depois da agenda aberta. */
export function bookingNotOpenMessage(unitName: string, openUntil: string, waitlistEnabled: boolean): string {
  const offer = waitlistEnabled
    ? ' Se quiser, coloco você na lista de espera e aviso assim que abrir.'
    : ' Posso ver um horário até lá para você?'
  return `A agenda da unidade ${unitName} está aberta até ${formatDayMonth(openUntil)}. Depois disso ainda não foi liberada.${offer}`
}

/** Mensagem fixa quando a Clara tentou marcar (ou pôr na lista de espera) num dia sem atendimento. */
export function closedDayMessage(
  unitName: string,
  days: number[],
  unit?: UnitWorkingDays,
  today?: string,
  date?: string
): string {
  // Dia bloqueado (feriado, férias): diz que nesse dia não há atendimento.
  if (unit && date && isBlockedDate(unit, date)) {
    const next = today ? upcomingAttendanceDates(unit, today) : []
    const dates = next.length > 0 ? ` As próximas datas com atendimento são ${joinPt(next.map(formatShortDate))}.` : ''
    return `Em ${formatDayMonth(date)} não haverá atendimento na unidade ${unitName}.${dates} Qual fica melhor para você?`
  }
  // Expediente a cada N semanas: diz a repetição e as próximas datas certas.
  if (unit && today && hasSpacedRule(unit)) {
    const next = upcomingAttendanceDates(unit, today)
    const dates = next.length > 0 ? ` As próximas datas são ${joinPt(next.map(formatShortDate))}.` : ''
    return `A unidade ${unitName} atende ${describeSchedule(unit.scheduleRules!)}.${dates} Qual fica melhor para você?`
  }
  return `A unidade ${unitName} atende só às ${formatWorkingDaysPlural(days)}. Qual desses dias fica melhor para você?`
}
