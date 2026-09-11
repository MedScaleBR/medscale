import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readAmount } from '@/lib/finance/api-guard'

// Depósito ou retirada numa reserva. `amount` é sempre positivo; o sinal está
// em `type`. `account_id` é preenchido pela trigger
// trg_enforce_reserve_movement_account a partir da reserva — não vem do corpo,
// para não haver como apontar um movimento para outra conta.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const amount = readAmount(b.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'Valor inválido', code: 'amount_invalid' }, { status: 400 })
  }
  const type = b.type === 'withdrawal' ? 'withdrawal' : 'deposit'

  const supabase = await createClient()
  // Confirma que a reserva é desta conta antes de inserir: sem isso um id de
  // outra conta seria barrado só pela trigger, com erro 500 em vez de 404.
  const { data: reserve } = await supabase
    .from('finance_reserves')
    .select('id, archived_at')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (!reserve) return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
  if (reserve.archived_at) {
    return NextResponse.json(
      { error: 'Reserva arquivada — desarquive para movimentar', code: 'reserve_archived' },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('finance_reserve_movements')
    .insert({
      reserve_id: id,
      account_id: g.session.accountId,
      amount,
      type,
      source: 'web',
      note: b.note ? String(b.note).trim() : null,
      ...(b.occurred_at ? { occurred_at: String(b.occurred_at) } : {}),
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}

// Remove um movimento lançado por engano. O id vai na query string porque a
// rota já usa o path para a reserva.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const movementId = req.nextUrl.searchParams.get('movimento')
  if (!movementId) {
    return NextResponse.json({ error: 'movimento obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_reserve_movements')
    .delete({ count: 'exact' })
    .eq('id', movementId)
    .eq('reserve_id', id)
    .eq('account_id', g.session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Movimento não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
