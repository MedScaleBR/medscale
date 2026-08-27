import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { DashboardStats } from '@/lib/types'

// workspaceIds: uma workspace (visão normal) ou várias (visão consolidada,
// ver WorkspaceTabs no dashboard) — todas já vêm filtradas por RLS/sessão.
export async function getDashboardStats(
  supabase: SupabaseClient<Database>,
  workspaceIds: string[]
): Promise<DashboardStats> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
  const today = now.toISOString().split('T')[0]

  const [appts, revenue, noshow, todayAppts, campaigns] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, source, workspace_id', { count: 'exact' })
      .in('workspace_id', workspaceIds)
      .gte('scheduled_at', monthStart)
      .lte('scheduled_at', monthEnd)
      .not('status', 'in', '("cancelado")'),

    supabase
      .from('revenue_entries')
      .select('amount, status, payment_status, workspace_id')
      .in('workspace_id', workspaceIds)
      .gte('entry_date', today.slice(0, 7) + '-01')
      .lte('entry_date', monthEnd.slice(0, 10)),

    supabase
      .from('appointments')
      .select('id, source', { count: 'exact' })
      .in('workspace_id', workspaceIds)
      .gte('scheduled_at', monthStart)
      .lte('scheduled_at', monthEnd)
      .eq('status', 'no_show'),

    supabase
      .from('appointments')
      .select('id, patient_name, patient_phone, scheduled_at, type, source, status')
      .in('workspace_id', workspaceIds)
      .gte('scheduled_at', `${today}T00:00:00`)
      .lte('scheduled_at', `${today}T23:59:59`)
      .not('status', 'in', '("cancelado")')
      .order('scheduled_at'),

    supabase
      .from('ad_campaigns')
      .select('channel, spend, leads, clicks, impressions')
      .in('workspace_id', workspaceIds)
      .gte('period_start', today.slice(0, 7) + '-01'),
  ])

  const totalAppts = appts.count ?? 0
  const botAppts = appts.data?.filter((a) => a.source === 'bot').length ?? 0

  // Ciclo de receita via payment_status, com ponte para lançamentos legados
  // (payment_status ainda no default 'pending' mas com o status antigo já
  // 'confirmado'/'cancelado').
  let projectedRev = 0
  let realizedRev = 0
  let receivedRev = 0
  for (const r of revenue.data ?? []) {
    const amount = Number(r.amount) || 0
    const legacyPending = r.payment_status === 'pending'
    const isPaid = r.payment_status === 'paid' || (legacyPending && r.status === 'confirmado')
    const isCancelled =
      r.payment_status === 'cancelled' ||
      r.payment_status === 'refunded' ||
      (legacyPending && r.status === 'cancelado')
    if (isCancelled) continue
    projectedRev += amount
    if (isPaid || r.payment_status === 'realized') realizedRev += amount
    if (isPaid) receivedRev += amount
  }
  const noShowRate = totalAppts > 0 ? Math.round(((noshow.count ?? 0) / totalAppts) * 100) : 0

  const trafficByChannel = (campaigns.data ?? []).reduce(
    (acc: Record<string, { spend: number; leads: number; clicks: number }>, c) => {
      if (!acc[c.channel]) acc[c.channel] = { spend: 0, leads: 0, clicks: 0 }
      acc[c.channel].spend += Number(c.spend)
      acc[c.channel].leads += c.leads ?? 0
      acc[c.channel].clicks += c.clicks ?? 0
      return acc
    },
    {}
  )

  const byWorkspace = workspaceIds.map((workspaceId) => ({
    workspaceId,
    appointments: appts.data?.filter((a) => a.workspace_id === workspaceId).length ?? 0,
    revenue:
      revenue.data
        ?.filter(
          (r) =>
            r.workspace_id === workspaceId &&
            r.payment_status !== 'cancelled' &&
            r.payment_status !== 'refunded' &&
            !(r.payment_status === 'pending' && r.status === 'cancelado')
        )
        .reduce((s, r) => s + Number(r.amount), 0) ?? 0,
  }))

  return {
    appointments: { total: totalAppts, bot: botAppts, manual: totalAppts - botAppts },
    revenue: {
      total: projectedRev,
      confirmed: receivedRev,
      projected: projectedRev,
      realized: realizedRev,
      received: receivedRev,
    },
    noShow: { rate: noShowRate, total: noshow.count ?? 0 },
    todayAgenda: todayAppts.data ?? [],
    traffic: trafficByChannel,
    byWorkspace,
  }
}
