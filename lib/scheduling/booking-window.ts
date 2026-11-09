// "Agenda aberta até" da unidade (workspaces.booking_open_until): último dia em
// que a Clara oferece ou marca horário. Vazio = sem limite.

export type BookingOpenUntilResult = { ok: true; value: string | null } | { ok: false; error: string }

export const BOOKING_OPEN_UNTIL_ERROR = 'Data inválida em "Agenda aberta até". Use o formato AAAA-MM-DD ou deixe em branco.'

/** Valida o campo vindo da tela: '' ou null = sem limite; senão uma data real AAAA-MM-DD. */
export function parseBookingOpenUntil(value: unknown): BookingOpenUntilResult {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: BOOKING_OPEN_UNTIL_ERROR }
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: BOOKING_OPEN_UNTIL_ERROR }
  }
  return { ok: true, value }
}

/** Último dia do mês seguinte a `today` (AAAA-MM-DD) — atalho da tela. */
export function endOfNextMonth(today: string): string {
  const [y, m] = today.split('-').map(Number)
  // Dia 0 do mês m+2 (base 1) = último dia do mês m+1.
  const last = new Date(Date.UTC(y, m + 1, 0))
  return last.toISOString().slice(0, 10)
}
