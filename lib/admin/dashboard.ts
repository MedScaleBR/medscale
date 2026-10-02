import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountPlan, Database } from '@/types/database'

export interface AdminTaskItem {
  id: string
  title: string
  dueDate: string | null
  accountId: string | null
  accountName: string | null
}

export interface AdminDashboardStats {
  totalAccounts: number
  activeAccounts: number
  inactiveAccounts: number
  byPlan: Record<AccountPlan, number>
  newLast30Days: number
  newLast90Days: number
  overdueTasks: AdminTaskItem[]
  upcomingTasks: AdminTaskItem[]
}

export async function getAdminDashboardStats(supabase: SupabaseClient<Database>): Promise<AdminDashboardStats> {
  const now = new Date()
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const last90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const today = now.toISOString().slice(0, 10)

  const [accountsRes, tasksRes] = await Promise.all([
    supabase.from('accounts').select('id, plan, is_active, created_at'),
    supabase
      .from('account_tasks')
      .select('id, title, due_date, account_id, accounts(name)')
      .eq('status', 'pending')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
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

  const tasks: AdminTaskItem[] = (tasksRes.data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    accountId: t.account_id,
    accountName: t.accounts?.name ?? null,
  }))

  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < today)
  const upcomingTasks = tasks.filter((t) => !t.dueDate || t.dueDate >= today)

  return {
    totalAccounts: accounts.length,
    activeAccounts,
    inactiveAccounts: accounts.length - activeAccounts,
    byPlan,
    newLast30Days,
    newLast90Days,
    overdueTasks,
    upcomingTasks,
  }
}
