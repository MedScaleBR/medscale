import { normalizeCategoryName } from './default-categories'
import type { FinanceReserve, FinanceReserveMovement, ReserveWithBalance } from './types'

// Saldo de uma reserva. Nunca é coluna no banco: é sempre a soma dos
// movimentos, para o histórico não poder divergir do total exibido.
// amount é sempre positivo; o sinal vem de `type`.
export function reserveBalance(movements: FinanceReserveMovement[]): number {
  return movements.reduce(
    (sum, m) => sum + (m.type === 'deposit' ? m.amount : -m.amount),
    0
  )
}

// Junta cada reserva aos seus movimentos, do mais recente para o mais antigo.
export function attachBalances(
  reserves: FinanceReserve[],
  movements: FinanceReserveMovement[]
): ReserveWithBalance[] {
  const byReserve = new Map<string, FinanceReserveMovement[]>()
  for (const m of movements) {
    const list = byReserve.get(m.reserve_id) ?? []
    list.push(m)
    byReserve.set(m.reserve_id, list)
  }
  return reserves.map((r) => {
    const own = (byReserve.get(r.id) ?? []).sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at)
    )
    return { ...r, movements: own, balance: reserveBalance(own) }
  })
}

// Casa o nome que o owner falou no WhatsApp ("reserva de emergência") contra
// as reservas da conta. Usa a mesma normalização das categorias (ignora caixa
// e acento), depois tenta conter/ser contido — "emergência" acha "Reserva de
// emergência".
//
// Devolve 'none' quando não achou (o agente PERGUNTA se quer criar, nunca
// cria calado) e 'many' quando o trecho casa com mais de uma (o agente pede
// para o owner desambiguar, em vez de escolher uma e lançar na caixinha errada).
export type ReserveMatch =
  | { status: 'one'; reserve: FinanceReserve }
  | { status: 'none' }
  | { status: 'many'; reserves: FinanceReserve[] }

export function resolveReserveByName(
  reserves: FinanceReserve[],
  spoken: string
): ReserveMatch {
  const target = normalizeCategoryName(spoken)
  if (!target) return { status: 'none' }

  const active = reserves.filter((r) => r.archived_at == null)

  const exact = active.filter((r) => normalizeCategoryName(r.name) === target)
  if (exact.length === 1) return { status: 'one', reserve: exact[0] }
  if (exact.length > 1) return { status: 'many', reserves: exact }

  const partial = active.filter((r) => {
    const name = normalizeCategoryName(r.name)
    return name.includes(target) || target.includes(name)
  })
  if (partial.length === 1) return { status: 'one', reserve: partial[0] }
  if (partial.length > 1) return { status: 'many', reserves: partial }

  return { status: 'none' }
}
