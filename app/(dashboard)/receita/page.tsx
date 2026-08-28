import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'
import { summarizeRevenueEntries } from '@/lib/revenue/summary'
import { RevenueClient, type RevenueLedgerEntry } from '@/components/receita/RevenueClient'
import type { RevenuePaymentStatus } from '@/types/database'

const ALL_STATUSES: RevenuePaymentStatus[] = ['pending', 'realized', 'paid', 'cancelled', 'refunded']

// Primeiro dia do mês seguinte a `YYYY-MM` — limite superior exclusivo da query.
function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1)) // m já é 1-based → Date meses 0-based → mês seguinte
  return d.toISOString().slice(0, 10)
}

export default async function ReceitaPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string }>
}) {
  const session = await resolveActiveSession()
  if (!session) return null

  // Ledger do ciclo de receita: owner e admin (recepção). member não.
  if (session.role === 'member' || !session.userModules.includes('revenue_cycle')) {
    redirect('/dashboard')
  }

  const isOwner = session.role === 'owner'
  const { month: monthParam, status: statusParam } = await searchParams

  const currentMonth = saoPauloDateOnly(new Date().toISOString()).slice(0, 7)
  const month = monthParam === 'all' || /^\d{4}-\d{2}$/.test(monthParam ?? '') ? monthParam! : currentMonth

  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => ALL_STATUSES.includes(s as RevenuePaymentStatus)) as RevenuePaymentStatus[])
    : ALL_STATUSES

  const supabase = createAdminClient()
  let query = supabase
    .from('revenue_entries')
    .select(
      'id, amount, status, payment_status, payment_method, paid_at, due_date, entry_date, procedure_name, ' +
        'installments, notes, appointment_id, appointments(scheduled_at, patient_name), patients(full_name)'
    )
    .eq('workspace_id', session.workspaceId)
    .in('payment_status', statuses)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (month !== 'all') {
    query = query.gte('entry_date', `${month}-01`).lt('entry_date', nextMonthStart(month))
  }

  const { data } = await query
  const rows = (data ?? []) as unknown as RevenueLedgerEntry[]

  // Totais do período carregado — exclusivos do owner.
  const totals = isOwner
    ? summarizeRevenueEntries(rows.map((r) => ({ amount: r.amount, payment_status: r.payment_status })))
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Receita</h1>
        <p className="text-sm text-gray-400">Histórico completo de entradas — previstas, realizadas e recebidas.</p>
      </div>

      <RevenueClient
        initialEntries={rows}
        totals={totals}
        isOwner={isOwner}
        month={month}
        currentMonth={currentMonth}
        statusFilter={statuses}
      />
    </div>
  )
}
