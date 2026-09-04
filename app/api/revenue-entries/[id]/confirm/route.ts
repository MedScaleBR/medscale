import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import { mirrorPaidRevenueToFinance } from '@/lib/revenue/finance-mirror'
import type { RevenuePaymentMethod } from '@/types/database'

// Confirmação de pagamento de uma consulta (1 clique na tela, ou via agente
// financeiro no WhatsApp). Owner e admin (recepção). Client admin — mesma
// razão de /api/revenue-entries. Move a entrada realizada/prevista → paga.

const PAYMENT_METHODS: RevenuePaymentMethod[] = [
  'pix',
  'cartao_credito',
  'cartao_debito',
  'dinheiro',
  'transferencia',
  'outro',
]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  if (session.role === 'member') {
    return NextResponse.json({ error: 'Restrito a owner e admin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const paymentMethod = body.payment_method as RevenuePaymentMethod | undefined
  if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod)) {
    return NextResponse.json(
      { error: `payment_method deve ser um de: ${PAYMENT_METHODS.join(', ')}` },
      { status: 400 }
    )
  }
  const installments = Number(body.installments ?? 1)

  const supabase = createAdminClient()

  // Só confirma entradas ainda não pagas do próprio workspace.
  const { data: entry } = await supabase
    .from('revenue_entries')
    .select('id, payment_status')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .eq('workspace_id', session.workspaceId)
    .maybeSingle()

  if (!entry) return NextResponse.json({ error: 'Entrada não encontrada' }, { status: 404 })
  if (entry.payment_status === 'paid') {
    return NextResponse.json({ error: 'Pagamento já confirmado' }, { status: 409 })
  }
  if (entry.payment_status === 'cancelled' || entry.payment_status === 'refunded') {
    return NextResponse.json({ error: 'Entrada cancelada ou reembolsada' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('revenue_entries')
    .update({
      payment_status: 'paid',
      status: 'confirmado',
      payment_method: paymentMethod,
      installments: Number.isFinite(installments) && installments >= 1 ? Math.floor(installments) : 1,
      paid_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('account_id', session.accountId)
    .eq('workspace_id', session.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await mirrorPaidRevenueToFinance(supabase, {
    id: data.id,
    accountId: data.account_id,
    workspaceId: data.workspace_id,
    amount: Number(data.amount),
    procedureName: data.procedure_name ?? null,
    paidAtIso: data.paid_at ?? null,
  })

  return NextResponse.json(data)
}
