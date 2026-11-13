import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchAllPages } from '@/lib/supabase/paginate'
import { MAX_EVENTS } from '@/lib/admin/cost-alerts'
import type { CostWindow } from '@/lib/admin/cost-range'
import { buildAccountCostDetail, type AccountCostDetail, type AccountCostRow } from '@/lib/costs/account-detail'

export interface AccountCostDetailResult {
  detail: AccountCostDetail
  /** Bateu em MAX_EVENTS — valores subestimados. */
  truncated: boolean
  error: string | null
}

/** cost_events de um cliente no período, agregados para a aba "Por cliente". */
export async function getAccountCostDetail(
  supabase: SupabaseClient<Database>,
  accountId: string,
  window: CostWindow,
  now: Date = new Date(),
): Promise<AccountCostDetailResult> {
  const result = await fetchAllPages<AccountCostRow>(
    (from, to) => {
      const q = supabase
        .from('cost_events')
        .select('provider, cost_brl, workspace_id, related_id, quantity, created_at, workspaces(name)')
        .eq('account_id', accountId)
        .gte('created_at', window.since)
      return (window.until ? q.lt('created_at', window.until) : q)
        .order('created_at')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: AccountCostRow[] | null; error: { message: string } | null }>
    },
    { max: MAX_EVENTS },
  )

  return {
    detail: buildAccountCostDetail(result.rows, window, now),
    truncated: result.truncated,
    error: result.error,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Cliente da aba "Por cliente" a partir de ?account=. Vazio, repetido ou que
 * não é uuid cai no cliente mais caro do período — um id inválido iria ao
 * Postgres e voltaria como erro. Um uuid válido fora da lista é mantido: é um
 * cliente sem custo no período, e a tela mostra o vazio dele.
 */
export function pickAccountId(
  param: string | string[] | undefined,
  accounts: { accountId: string }[],
): string | null {
  const first = Array.isArray(param) ? param[0] : param
  if (first && UUID.test(first)) return first
  return accounts[0]?.accountId ?? null
}
