// Bloqueios são gravados um por dia (availability_exceptions.date), mas a tela
// trabalha com períodos: expande um intervalo em dias e reagrupa dias seguidos.

/** Todas as datas de `from` até `to` (inclusive), em YYYY-MM-DD. */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface BlockedRange {
  start: string
  end: string
  reason: string | null
  ids: string[]
}

/** Junta dias consecutivos com o mesmo motivo num único período. */
export function groupBlockedDays(days: Array<{ id: string; date: string; reason: string | null }>): BlockedRange[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const ranges: BlockedRange[] = []
  for (const day of sorted) {
    const last = ranges.at(-1)
    const reason = day.reason || null
    if (last && last.reason === reason && nextDay(last.end) === day.date) {
      last.end = day.date
      last.ids.push(day.id)
    } else {
      ranges.push({ start: day.date, end: day.date, reason, ids: [day.id] })
    }
  }
  return ranges
}
