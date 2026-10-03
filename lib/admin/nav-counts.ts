import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { OPEN_TASK_STATUSES, saoPauloDate } from '@/lib/admin/queue'

export interface AdminNavCounts {
  overdueTasks: number
  unreadFeedback: number
}

// Contadores da topbar do /admin. Roda em todo request do layout, então só
// conta (head: true) — nenhuma linha trafega. Erro vira 0: um contador some,
// a navegação não quebra.
export async function getNavCounts(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<AdminNavCounts> {
  const today = saoPauloDate(now)

  const [tasksRes, feedbackRes] = await Promise.all([
    supabase
      .from('account_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', OPEN_TASK_STATUSES)
      .lt('due_date', today),
    supabase.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ])

  return {
    overdueTasks: tasksRes.count ?? 0,
    unreadFeedback: feedbackRes.count ?? 0,
  }
}
