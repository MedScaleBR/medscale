import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'
import type { RevenuePaymentStatus } from '@/types/database'

// Lista de entradas do ciclo de receita para a tela /ciclo-receita.
// Owner e admin (recepção) — member não. Client admin porque revenue_entries
// tem RLS exclusiva de owner; o acesso de admin é liberado aqui, na rota,
// escopado ao workspace da sessão. Totais agregados NÃO saem daqui (são
// exclusivos do owner e calculados na página).

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  if (session.role === 'member') {
    return NextResponse.json({ error: 'Restrito a owner e admin' }, { status: 403 })
  }

  const today = saoPauloDateOnly(new Date().toISOString())
  const from = req.nextUrl.searchParams.get('from') ?? today
  const to = req.nextUrl.searchParams.get('to') ?? today
  const statusParam = req.nextUrl.searchParams.get('status')
  const ALL_STATUSES: RevenuePaymentStatus[] = ['pending', 'realized', 'paid', 'cancelled', 'refunded']
  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => ALL_STATUSES.includes(s as RevenuePaymentStatus)) as RevenuePaymentStatus[])
    : (['pending', 'realized', 'paid'] as RevenuePaymentStatus[])

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('revenue_entries')
    .select(
      'id, amount, payment_status, payment_method, paid_at, due_date, procedure_name, installments, appointment_id, ' +
        'appointments(scheduled_at, patient_name, status), patients(full_name)'
    )
    .eq('account_id', session.accountId)
    .eq('workspace_id', session.workspaceId)
    .gte('due_date', from)
    .lte('due_date', to)
    .in('payment_status', statuses)
    .order('due_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
