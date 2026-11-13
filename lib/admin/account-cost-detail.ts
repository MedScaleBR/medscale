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
