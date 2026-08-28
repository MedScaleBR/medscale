import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { saoPauloDateOnly, ledgerPeriod, type LedgerRange } from '@/lib/revenue/cycle'
import { summarizeRevenueEntries } from '@/lib/revenue/summary'
import {
  RevenueClient,
  type RevenueLedgerEntry,
  type HealthPlanConsultation,
} from '@/components/receita/RevenueClient'
import type { RevenuePaymentStatus } from '@/types/database'

const ALL_STATUSES: RevenuePaymentStatus[] = ['pending', 'realized', 'paid', 'cancelled', 'refunded']

export default async function CicloReceitaPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; status?: string }>
}) {
  const session = await resolveActiveSession()
  if (!session) return null

  // Ciclo de receita: owner e admin (recepção confirma pagamentos). member não.
  if (session.role === 'member' || !session.userModules.includes('revenue_cycle')) {
    redirect('/dashboard')
  }

  const isOwner = session.role === 'owner'
  const { range: rangeParam, status: statusParam } = await searchParams

  const currentMonth = saoPauloDateOnly(new Date().toISOString()).slice(0, 7)
  const today = saoPauloDateOnly(new Date().toISOString())
  const range: LedgerRange =
    rangeParam === 'all' || /^\d{4}-\d{2}$/.test(rangeParam ?? '') ? rangeParam! : 'today'

  const period = ledgerPeriod(range, today)

  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => ALL_STATUSES.includes(s as RevenuePaymentStatus)) as RevenuePaymentStatus[])
    : ALL_STATUSES

  const supabase = createAdminClient()

  let entryQuery = supabase
    .from('revenue_entries')
    .select(
      'id, amount, status, payment_status, payment_method, paid_at, due_date, entry_date, procedure_name, ' +
        'installments, notes, appointment_id, appointments(scheduled_at, patient_name), patients(full_name)'
    )
    .eq('workspace_id', session.workspaceId)
    .in('payment_status', statuses)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (period.entryFrom) entryQuery = entryQuery.gte('entry_date', period.entryFrom)
  if (period.entryTo) entryQuery = entryQuery.lt('entry_date', period.entryTo)

  const { data } = await entryQuery
  const rows = (data ?? []) as unknown as RevenueLedgerEntry[]

  // Consultas por plano de saúde do período — ficam fora do ciclo de receita
  // (sem revenue_entry), então vêm direto de appointments.
  let planQuery = supabase
    .from('appointments')
    .select('id, scheduled_at, patient_name, health_plan')
    .eq('workspace_id', session.workspaceId)
    .not('health_plan', 'is', null)
    .neq('status', 'cancelado')
    .order('scheduled_at', { ascending: false })

  if (period.schedFromIso) planQuery = planQuery.gte('scheduled_at', period.schedFromIso)
  if (period.schedToIso) planQuery = planQuery.lt('scheduled_at', period.schedToIso)

  const { data: planData } = await planQuery
  const healthPlanConsultations = (planData ?? []) as HealthPlanConsultation[]

  const totals = isOwner
    ? summarizeRevenueEntries(rows.map((r) => ({ amount: r.amount, payment_status: r.payment_status })))
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Ciclo de receita</h1>
        <p className="text-sm text-gray-400">
          Pagamentos das consultas e histórico de entradas — previstas, realizadas e recebidas.
        </p>
      </div>

      <RevenueClient
        initialEntries={rows}
        totals={totals}
        isOwner={isOwner}
        range={range}
        currentMonth={currentMonth}
        statusFilter={statuses}
        scopeLabel={period.scopeLabel}
        healthPlanConsultations={healthPlanConsultations}
      />
    </div>
  )
}
