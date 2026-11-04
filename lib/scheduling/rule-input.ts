import { recurrenceProblem } from './recurrence'

// Repetição vinda do corpo das rotas de availability_rules. Toda semana não
// grava as colunas novas (o cadastro continua funcionando antes da migration).

export type RecurrenceUpdate = { interval_weeks?: number; anchor_date?: string | null }

export function parseRecurrence(
  dayOfWeek: unknown,
  body: { interval_weeks?: unknown; anchor_date?: unknown }
): { ok: true; value: RecurrenceUpdate } | { ok: false; error: string } {
  if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { ok: false, error: 'Dia da semana inválido.' }
  }
  const interval = body.interval_weeks ?? 1
  const anchor = body.anchor_date === '' ? null : (body.anchor_date ?? null)
  const problem = recurrenceProblem({ day_of_week: dayOfWeek, interval_weeks: interval, anchor_date: anchor })
  if (problem) return { ok: false, error: problem }
  if (interval === 1) {
    // Só zera as colunas se o pedido falou delas (PATCH de quinzenal → semanal).
    return { ok: true, value: 'interval_weeks' in body || 'anchor_date' in body ? { interval_weeks: 1, anchor_date: null } : {} }
  }
  return { ok: true, value: { interval_weeks: interval as number, anchor_date: anchor as string } }
}
