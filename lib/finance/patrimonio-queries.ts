import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getFinanceCategoryTree } from './categories'
import { attachBalances } from './reserves'
import { shiftMonth } from './summary'
import { DEFAULT_TOLERANCE, flattenCategories, type SuggestionContext } from './suggestions'
import type { GoalContext } from './goals'
import type { FinanceEntryType, ReserveWithBalance } from './types'

// Leituras compostas do patrimônio. Ficam fora das rotas porque as mesmas
// consultas são feitas pelas telas (client autenticado) e pelo agente do
// WhatsApp (admin client) — o cliente vem por parâmetro, a query é a mesma.

type Client = SupabaseClient<Database>

// Quantos meses anteriores entram na média histórica das sugestões.
const HISTORY_MONTHS = 3

// Primeiro e último dia do mês 'YYYY-MM', para os filtros de data.
function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export async function loadReserves(
  client: Client,
  accountId: string,
  opts: { kind?: FinanceEntryType; includeArchived?: boolean } = {}
): Promise<ReserveWithBalance[]> {
  let q = client
    .from('finance_reserves')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (opts.kind) q = q.eq('kind', opts.kind)
  if (!opts.includeArchived) q = q.is('archived_at', null)

  const { data: reserves } = await q
  const ids = (reserves ?? []).map((r) => r.id)
  if (ids.length === 0) return []

  const { data: movements } = await client
    .from('finance_reserve_movements')
    .select('*')
    .in('reserve_id', ids)
    .order('occurred_at', { ascending: false })

  return attachBalances(reserves ?? [], movements ?? [])
}

// Contexto de uma meta: reservas com saldo, investimentos e as projeções do
// mês de referência. Metas automáticas são recalculadas a partir disto a cada
// leitura — nada de valor congelado no banco.
export async function loadGoalContext(
  client: Client,
  accountId: string,
  periodMonth: string
): Promise<GoalContext> {
  const [reserves, investments, projections] = await Promise.all([
    loadReserves(client, accountId),
    client.from('finance_investments').select('*').eq('account_id', accountId),
    client
      .from('finance_projections')
      .select('*')
      .eq('account_id', accountId)
      .eq('period_month', `${periodMonth}-01`),
  ])

  return {
    reserves,
    investments: investments.data ?? [],
    projections: projections.data ?? [],
  }
}

// Contexto das sugestões: lançamentos do mês, dos 3 meses anteriores,
// projeções, árvore de categorias, tolerâncias e alertas já descartados.
export async function loadSuggestionContext(
  client: Client,
  accountId: string,
  periodMonth: string,
  kind: FinanceEntryType
): Promise<SuggestionContext> {
  const current = monthRange(periodMonth)
  const historyStart = monthRange(shiftMonth(periodMonth, -HISTORY_MONTHS)).from
  const historyEnd = monthRange(shiftMonth(periodMonth, -1)).to

  const [entries, historical, projections, tree, settings, dismissals] = await Promise.all([
    client
      .from('finance_entries')
      .select('*')
      .eq('account_id', accountId)
      .eq('type', kind)
      .gte('entry_date', current.from)
      .lte('entry_date', current.to),
    client
      .from('finance_entries')
      .select('*')
      .eq('account_id', accountId)
      .eq('type', kind)
      .gte('entry_date', historyStart)
      .lte('entry_date', historyEnd),
    client
      .from('finance_projections')
      .select('*')
      .eq('account_id', accountId)
      .eq('period_month', current.from),
    getFinanceCategoryTree(client, accountId),
    client.from('finance_suggestion_settings').select('*').eq('account_id', accountId).maybeSingle(),
    client
      .from('finance_suggestion_dismissals')
      .select('*')
      .eq('account_id', accountId)
      .eq('period_month', current.from),
  ])

  // Projeção não guarda PF/PJ — o lado vem da categoria, então o recorte é por
  // id de categoria deste kind.
  const categories = flattenCategories(tree[kind])
  const ofKind = new Set(categories.map((c) => c.id))

  return {
    periodMonth,
    entries: entries.data ?? [],
    historicalEntries: historical.data ?? [],
    projections: (projections.data ?? []).filter((p) => ofKind.has(p.category_id)),
    categories,
    tolerance: {
      projectionPct: settings.data?.projection_tolerance_pct ?? DEFAULT_TOLERANCE.projectionPct,
      historyPct: settings.data?.history_tolerance_pct ?? DEFAULT_TOLERANCE.historyPct,
    },
    dismissals: dismissals.data ?? [],
  }
}
