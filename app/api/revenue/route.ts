import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import { revenueStatusToPaymentStatus } from '@/lib/revenue/cycle'
import type { RevenuePaymentMethod, RevenueStatus } from '@/types/database'

// Lançamento manual avulso na tela de ciclo de receita (/ciclo-receita).
// Owner e admin (recepção) — member não. Client admin porque revenue_entries
// tem RLS exclusiva de owner; o acesso de admin é liberado aqui, escopado ao
// workspace da sessão.
function guard(session: { role: string }) {
  if (session.role === 'member') {
    return NextResponse.json({ error: 'Restrito a owner e admin' }, { status: 403 })
  }
  return null
}

const PAYMENT_METHODS: RevenuePaymentMethod[] = [
  'pix',
  'cartao_credito',
  'cartao_debito',
  'dinheiro',
  'transferencia',
  'outro',
]
const REVENUE_STATUSES: RevenueStatus[] = ['previsto', 'confirmado', 'cancelado']

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  const denied = guard(session)
  if (denied) return denied

  // Segundo filtro de tenant, independente do workspace: revenue_entries usa
  // service role aqui (RLS e owner-only), entao nao ha backstop de RLS — os
  // dois .eq garantem que remover um por engano nao vaza entre contas.
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('revenue_entries')
    .select('*')
    .eq('account_id', session.accountId)
    .eq('workspace_id', session.workspaceId)
    .order('entry_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  const denied = guard(session)
  if (denied) return denied

  const supabase = createAdminClient()
  const body = await req.json()

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount deve ser um número positivo' }, { status: 400 })
  }

  const status: RevenueStatus = REVENUE_STATUSES.includes(body.status) ? body.status : 'previsto'
  const paymentStatus = revenueStatusToPaymentStatus(status)

  const paymentMethod: RevenuePaymentMethod | null =
    body.payment_method && PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : null

  const entryDate: string = body.entry_date ?? new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('revenue_entries')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      appointment_id: body.appointment_id ?? null,
      amount,
      status,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      // Lançamento avulso: sem consulta, a data esperada de recebimento é a
      // própria data do lançamento — mantém o ledger e os totais coerentes.
      due_date: entryDate,
      entry_date: entryDate,
      paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
      source: 'manual',
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
