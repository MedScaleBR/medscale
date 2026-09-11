import { TZDate } from '@date-fns/tz'
import { investmentCurrentValue } from './investments'
import type {
  FinanceGoal,
  FinanceInvestment,
  FinanceProjection,
  ReserveWithBalance,
} from './types'

const TZ = 'America/Sao_Paulo'

export type GoalStatus = {
  // Quanto já está guardado e conta para esta meta.
  currentSaved: number
  // Quanto precisa estar guardado no fim: target_amount (manual) ou derivado
  // das projeções (auto).
  requiredTotal: number
  // O que ainda falta. Nunca negativo — meta batida devolve 0.
  remaining: number
  // Meses cheios até o prazo. null sem target_date; 0 quando o prazo passou.
  monthsRemaining: number | null
  // Quanto guardar por mês. null sem target_date (não dá para dividir sem prazo).
  monthlyRequired: number | null
  // 0–100, já limitado, para a barra de progresso.
  progressPct: number
}

export type GoalContext = {
  // Reservas da conta COM saldo somado (ver reserveBalance em reserves.ts).
  reserves: ReserveWithBalance[]
  investments: FinanceInvestment[]
  // Projeções já recortadas no período de referência (mês corrente).
  projections: FinanceProjection[]
  today?: Date
}

// Despesa projetada do período. Uma categoria com valor próprio manda na
// própria subárvore: somar categoria E subcategoria contaria o mesmo dinheiro
// duas vezes ("Mercado 800" já inclui "Mercado > Feira 300"). Categoria sem
// valor próprio soma o que as subcategorias declararem.
export function projectedMonthlyExpense(projections: FinanceProjection[]): number {
  const byCategory = new Map<string, { root: number | null; subs: number }>()
  for (const p of projections) {
    const bucket = byCategory.get(p.category_id) ?? { root: null, subs: 0 }
    if (p.subcategory_id == null) bucket.root = (bucket.root ?? 0) + p.projected_amount
    else bucket.subs += p.projected_amount
    byCategory.set(p.category_id, bucket)
  }
  let total = 0
  for (const { root, subs } of byCategory.values()) total += root ?? subs
  return total
}

// Meses cheios entre hoje e o prazo, na wall-clock de SP. Prazo no mês
// corrente conta como 1 — senão a divisão do que falta seria por zero. Prazo
// vencido devolve 0, que o chamador lê como "cobra tudo agora".
function monthsUntil(targetDate: string, today: Date): number {
  const target = new TZDate(`${targetDate}T12:00:00`, TZ)
  if (isNaN(target.getTime())) return 0
  const now = new TZDate(today, TZ)
  if (target.getTime() <= now.getTime()) return 0
  const diff =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  return Math.max(1, diff)
}

// Quanto do patrimônio conta para esta meta. Vinculada a uma reserva, só
// aquela caixinha; solta, tudo que o owner tem do mesmo kind (reservas ativas
// + investimentos).
function savedFor(goal: FinanceGoal, ctx: GoalContext, today: Date): number {
  if (goal.linked_reserve_id) {
    const linked = ctx.reserves.find((r) => r.id === goal.linked_reserve_id)
    return linked?.balance ?? 0
  }
  const fromReserves = ctx.reserves
    .filter((r) => r.kind === goal.kind && r.archived_at == null)
    .reduce((sum, r) => sum + r.balance, 0)
  const fromInvestments = ctx.investments
    .filter((i) => i.kind === goal.kind)
    .reduce((sum, i) => sum + investmentCurrentValue(i, today), 0)
  return fromReserves + fromInvestments
}

// Situação da meta, SEMPRE derivada na leitura. Meta automática não guarda
// valor calculado no banco: mudou a projeção ou o saldo, muda o alvo na
// próxima leitura — é essa a diferença entre o modo auto e o manual.
export function calculateGoalStatus(goal: FinanceGoal, ctx: GoalContext): GoalStatus {
  const today = ctx.today ?? new Date()
  const currentSaved = savedFor(goal, ctx, today)

  const requiredTotal =
    goal.mode === 'manual'
      ? goal.target_amount ?? 0
      : projectedMonthlyExpense(ctx.projections) * goal.months_of_expenses

  const remaining = Math.max(0, requiredTotal - currentSaved)

  const monthsRemaining = goal.target_date ? monthsUntil(goal.target_date, today) : null
  const monthlyRequired =
    monthsRemaining == null
      ? null
      : // monthsRemaining 0 = prazo vencido: o que falta é para agora, inteiro.
        monthsRemaining === 0
        ? remaining
        : remaining / monthsRemaining

  const progressPct =
    requiredTotal > 0 ? Math.min(100, (currentSaved / requiredTotal) * 100) : currentSaved > 0 ? 100 : 0

  return { currentSaved, requiredTotal, remaining, monthsRemaining, monthlyRequired, progressPct }
}
