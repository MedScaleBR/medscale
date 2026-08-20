import { CalendarCheck, Bot, Wallet, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { getDashboardStats } from '@/lib/dashboard'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { AgendaHoje } from '@/components/dashboard/AgendaHoje'
import { RevenueChart } from '@/components/dashboard/RevenueChart'
import { NoShowMeter } from '@/components/dashboard/NoShowMeter'
import { TrafficTable } from '@/components/dashboard/TrafficTable'
import { WorkspaceTabs } from '@/components/dashboard/WorkspaceTabs'

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const session = await resolveActiveSession()
  if (!session) return null

  const { allWorkspaces, workspaceId } = session
  const isMultiWorkspace = allWorkspaces.length > 1
  const activeView = view ?? workspaceId

  const supabase = await createClient()
  const workspaceFilter = activeView === 'consolidated' ? allWorkspaces.map((w) => w.id) : [activeView]

  const stats = await getDashboardStats(supabase, workspaceFilter)
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const botShare = stats.appointments.total > 0 ? Math.round((stats.appointments.bot / stats.appointments.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-gray-900">
            {activeView === 'consolidated' ? 'Visão consolidada' : 'Visão geral'}
          </h1>
          <p className="text-sm text-gray-400">Resumo do mês atual</p>
        </div>
      </div>

      {isMultiWorkspace && <WorkspaceTabs workspaces={allWorkspaces} activeView={activeView} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Consultas no mês"
          value={stats.appointments.total}
          icon={CalendarCheck}
          barWidth={100}
          barColor="cyan"
        />
        <KpiCard
          label="Agendadas pelo bot"
          value={`${stats.appointments.bot} (${botShare}%)`}
          icon={Bot}
          barWidth={botShare}
          barColor="cyan"
        />
        <KpiCard
          label="Receita confirmada"
          value={formatBRL(stats.revenue.confirmed)}
          icon={Wallet}
          barWidth={stats.revenue.projected > 0 ? Math.round((stats.revenue.confirmed / stats.revenue.projected) * 100) : 0}
          barColor="green"
        />
        <KpiCard
          label="Taxa de no-show"
          value={`${stats.noShow.rate}%`}
          icon={TrendingUp}
          barWidth={stats.noShow.rate}
          barColor={stats.noShow.rate >= 15 ? 'red' : 'cyan'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AgendaHoje items={stats.todayAgenda} />
        </div>
        <NoShowMeter rate={stats.noShow.rate} total={stats.noShow.total} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RevenueChart confirmed={stats.revenue.confirmed} projected={stats.revenue.projected} />
        <TrafficTable traffic={stats.traffic} />
      </div>

      {activeView === 'consolidated' && isMultiWorkspace && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-gray-500">Por unidade</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.byWorkspace.map((w) => {
              const workspace = allWorkspaces.find((aw) => aw.id === w.workspaceId)
              return (
                <div key={w.workspaceId} className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
                  <p className="font-medium text-gray-800">{workspace?.name ?? w.workspaceId}</p>
                  <div className="mt-2 flex gap-4 text-sm text-gray-500">
                    <span>{w.appointments} consultas</span>
                    <span>{formatBRL(w.revenue)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
