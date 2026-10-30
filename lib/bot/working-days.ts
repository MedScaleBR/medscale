import { TZDate } from '@date-fns/tz'

// Dias da semana em que a unidade atende, tirados do expediente
// (availability_rules) e das datas avulsas abertas (availability_exceptions
// do tipo 'extra'). Vale para toda unidade, inclusive a de agenda externa:
// lá a Clara não tem os horários, mas sabe em que dias o doutor atende.

export interface UnitWorkingDays {
  /** 0=domingo … 6=sábado, em ordem. Vazio/ausente = expediente não cadastrado. */
  workingDays?: number[]
  /** Datas avulsas (AAAA-MM-DD) em que a unidade abre fora dos dias fixos. */
  extraDates?: string[]
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
  if (!hasWorkingDays(unit)) return true
  return unit.workingDays!.includes(weekdayOf(date)) || (unit.extraDates ?? []).includes(date)
}

/** Mensagem fixa quando a Clara tentou marcar (ou pôr na lista de espera) num dia sem atendimento. */
export function closedDayMessage(unitName: string, days: number[]): string {
  return `A unidade ${unitName} atende só às ${formatWorkingDaysPlural(days)}. Qual desses dias fica melhor para você?`
}
