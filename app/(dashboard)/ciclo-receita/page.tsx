import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { getRevenueTotals } from '@/lib/revenue/summary'
import { saoPauloDateOnly, saoPauloDayRange, saoPauloMonthRange } from '@/lib/revenue/cycle'
import {
  RevenueCycleClient,
  type RevenueCycleEntry,
  type HealthPlanConsultation,
} from '@/components/ciclo-receita/RevenueCycleClient'

export default async function CicloReceitaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Ciclo de receita: owner e admin (recepção confirma pagamentos). member não.
  if (session.role === 'member' || !session.userModules.includes('revenue_cycle')) {
    redirect('/dashboard')
  }

  const isOwner = session.role === 'owner'
  const supabase = createAdminClient()

  const today = saoPauloDateOnly(new Date().toISOString())
  const monthStart = today.slice(0, 7) + '-01'
  const day = saoPauloDayRange(today)
  const monthRange = saoPauloMonthRange(today.slice(0, 7))

  // Lista do dia — consultas cuja receita ainda precisa de ação ou foi paga hoje.
  const { data: entries } = await supabase
    .from('revenue_entries')
    .select(
      'id, amount, payment_status, payment_method, paid_at, due_date, procedure_name, installments, ' +
        'appointments(scheduled_at, patient_name, status), patients(full_name)'
    )
    .eq('workspace_id', session.workspaceId)
    .eq('due_date', today)
    .in('payment_status', ['pending', 'realized', 'paid'])
    .order('due_date', { ascending: true })

  // Consultas por plano de saúde de hoje — ficam fora do ciclo de receita
  // (não há revenue_entry), então vêm direto de appointments.
  const { data: healthPlanAppts } = await supabase
    .from('appointments')
    .select('id, scheduled_at, patient_name, health_plan')
    .eq('workspace_id', session.workspaceId)
    .not('health_plan', 'is', null)
    .neq('status', 'cancelado')
    .gte('scheduled_at', day.startIso)
    .lt('scheduled_at', day.endIso)
    .order('scheduled_at', { ascending: true })

  // Contagem do mês (KPI do owner).
  const { count: healthPlanMonthCount } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', session.workspaceId)
    .not('health_plan', 'is', null)
    .neq('status', 'cancelado')
    .gte('scheduled_at', monthRange.startIso)
    .lt('scheduled_at', monthRange.endIso)

  // Totais do mês — exclusivos do owner.
  const totals = isOwner ? await getRevenueTotals(supabase, session.workspaceId, monthStart, today) : null

  // O Database tipado à mão não modela selects relacionais — o embed de
  // appointments/patients no select cai no tipo de erro genérico.
  const rows = (entries ?? []) as unknown as RevenueCycleEntry[]
  const healthPlanConsultations = (healthPlanAppts ?? []) as HealthPlanConsultation[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Ciclo de receita</h1>
        <p className="text-sm text-gray-400">
          Pagamentos das consultas de hoje{isOwner ? ' e fechamento do mês' : ''}.
        </p>
      </div>

      <RevenueCycleClient
        initialEntries={rows}
        monthTotals={totals}
        isOwner={isOwner}
        healthPlanConsultations={healthPlanConsultations}
        healthPlanMonthCount={healthPlanMonthCount ?? 0}
      />
    </div>
  )
}
