import Link from 'next/link'
import { Building2, CircleCheck, TrendingUp, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAdminDashboardStats } from '@/lib/admin/dashboard'
import { getAdminQueue } from '@/lib/admin/queue'
import { PROVIDER_GROUP_LABELS, PROVIDER_GROUP_ORDER } from '@/lib/costs/aggregate'
import { formatBRL } from '@/lib/finance/summary'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { QueueList } from '@/components/admin/QueueList'
import { PlanSummary } from '@/components/admin/PlanSummary'

function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const [stats, queue] = await Promise.all([getAdminDashboardStats(supabase), getAdminQueue(supabase)])

  const total = stats.totalAccounts
  const cost = stats.cost30d
  const costSplit = PROVIDER_GROUP_ORDER.map(
    (g) => `${PROVIDER_GROUP_LABELS[g]} ${share(cost.byProvider[g] ?? 0, cost.total)}%`,
  ).join(' · ')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-400">Sua fila de trabalho de hoje</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <QueueList items={queue.items} />

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="Total de accounts" value={total} icon={Building2} barWidth={total > 0 ? 100 : 0} />
            <KpiCard
              label="Accounts ativas"
              value={stats.activeAccounts}
              icon={CircleCheck}
              barColor="green"
              barWidth={share(stats.activeAccounts, total)}
            />
            <KpiCard
              label="Novas (30 dias)"
              value={stats.newLast30Days}
              icon={TrendingUp}
              barWidth={share(stats.newLast30Days, total)}
            />
            <KpiCard
              label="Novas (90 dias)"
              value={stats.newLast90Days}
              icon={Users}
              barWidth={share(stats.newLast90Days, total)}
            />
          </div>

          <PlanSummary byPlan={stats.byPlan} />

          <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-900">Custo 30 dias</h2>
              <Link
                href="/admin/costs"
                className="rounded-[10px] text-xs text-[var(--cyan-dark)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
              >
                Custos
              </Link>
            </div>
            <p className="mt-3 text-2xl font-medium tracking-tight text-gray-900">{formatBRL(cost.total)}</p>
            <p className="mt-1 text-xs text-gray-400">
              {cost.total > 0 ? costSplit : 'Sem custos nos últimos 30 dias'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
