import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountPlan, Database } from '@/types/database'
import type { ProviderGroup } from '@/lib/costs/aggregate'
import { getCostTotals, type CostPeriodTotals } from '@/lib/admin/cost-alerts'

export interface AdminDashboardStats {
  totalAccounts: number
  activeAccounts: number
  inactiveAccounts: number
  byPlan: Record<AccountPlan, number>
  newLast30Days: number
  newLast90Days: number
  /** Custo variável dos últimos 30 dias, total e por grupo de provedor. */
  cost30d: { total: number; byProvider: Record<ProviderGroup, number> }
}

// cost30d: a página do dashboard já lê cost_events uma vez (getCostOverview,
// que também alimenta os alertas da fila) e passa os totais prontos. Sem
// eles, cai numa leitura só de totais.
export async function getAdminDashboardStats(
  supabase: SupabaseClient<Database>,
  options: { costTotals?: CostPeriodTotals; now?: Date } = {},
): Promise<AdminDashboardStats> {
  const now = options.now ?? new Date()
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const last90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const [accountsRes, costTotals] = await Promise.all([
    supabase.from('accounts').select('id, plan, is_active, created_at'),
    options.costTotals ?? getCostTotals(supabase, 30, now),
  ])

  const accounts = accountsRes.data ?? []
  const byPlan: Record<AccountPlan, number> = { essencial: 0, avancado: 0, premium: 0 }
  let activeAccounts = 0
  let newLast30Days = 0
  let newLast90Days = 0

  for (const a of accounts) {
    byPlan[a.plan] = (byPlan[a.plan] ?? 0) + 1
    if (a.is_active) activeAccounts += 1
    const createdAt = new Date(a.created_at)
    if (createdAt >= last30) newLast30Days += 1
    if (createdAt >= last90) newLast90Days += 1
  }

  return {
    totalAccounts: accounts.length,
    activeAccounts,
    inactiveAccounts: accounts.length - activeAccounts,
    byPlan,
    newLast30Days,
    newLast90Days,
    cost30d: { total: costTotals.total, byProvider: costTotals.byGroup },
  }
}
