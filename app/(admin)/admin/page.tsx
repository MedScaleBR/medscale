import { Building2, CheckCircle2, TrendingUp, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAdminDashboardStats } from '@/lib/admin/dashboard'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { TasksWidget } from '@/components/admin/TasksWidget'
import { Badge } from '@/components/ui/badge'

const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', avancado: 'Avançado', premium: 'Premium' }

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const stats = await getAdminDashboardStats(supabase)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-400">Visão geral das accounts da MedScale</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Total de accounts" value={stats.totalAccounts} icon={Building2} />
        <KpiCard label="Accounts ativas" value={stats.activeAccounts} icon={CheckCircle2} barColor="green" />
        <KpiCard label="Novas (30 dias)" value={stats.newLast30Days} icon={TrendingUp} />
        <KpiCard label="Novas (90 dias)" value={stats.newLast90Days} icon={Users} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-sm font-medium text-gray-900">Accounts por plano</h2>
          <ul className="mt-3 space-y-2">
            {(Object.entries(stats.byPlan) as [string, number][]).map(([plan, count]) => (
              <li key={plan} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{PLAN_LABEL[plan] ?? plan}</span>
                <Badge className="border-none bg-[var(--navy-06)] text-gray-700">{count}</Badge>
              </li>
            ))}
          </ul>
        </div>

        <TasksWidget overdue={stats.overdueTasks} upcoming={stats.upcomingTasks} />
      </div>
    </div>
  )
}
