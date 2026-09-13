import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readAmount, readInvestmentType, readRateType } from '@/lib/finance/api-guard'

// Editar (inclusive só atualizar o valor atual, que é o uso mais comum) e
// excluir um investimento. Diferente de reserva, investimento não tem histórico
// de movimentos — excluir não deixa órfão, então não há trava de exclusão.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const patch: Database['public']['Tables']['finance_investments']['Update'] = {}

  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })
    patch.name = name
  }
  if (b.type !== undefined) {
    const type = readInvestmentType(b.type)
    if (!type) return NextResponse.json({ error: 'Tipo inválido', code: 'type_invalid' }, { status: 400 })
    patch.type = type
  }
  if (b.invested_amount !== undefined) {
    const amount = readAmount(b.invested_amount)
    if (amount == null) {
      return NextResponse.json({ error: 'Valor investido inválido', code: 'amount_invalid' }, { status: 400 })
    }
    patch.invested_amount = amount
  }
  if (b.current_value !== undefined) {
    patch.current_value = b.current_value === null ? null : readAmount(b.current_value)
  }
  // rate_type: null limpa a taxa junto com o valor — meio-caminho geraria
  // projeção sem base.
  if (b.rate_type !== undefined) {
    if (b.rate_type === null) {
      patch.rate_type = null
      patch.rate_value = null
    } else {
      const rateType = readRateType(b.rate_type)
      if (!rateType) {
        return NextResponse.json({ error: 'Tipo de taxa inválido', code: 'rate_type_invalid' }, { status: 400 })
      }
      const rateValue = readAmount(b.rate_value)
      if (rateValue == null) {
        return NextResponse.json({ error: 'Taxa obrigatória para o tipo escolhido', code: 'rate_value_required' }, { status: 400 })
      }
      patch.rate_type = rateType
      patch.rate_value = rateValue
    }
  } else if (b.rate_value !== undefined) {
    const rateValue = readAmount(b.rate_value)
    if (rateValue == null) {
      return NextResponse.json({ error: 'Taxa inválida', code: 'rate_value_invalid' }, { status: 400 })
    }
    patch.rate_value = rateValue
  }
  if (b.start_date !== undefined) patch.start_date = String(b.start_date)
  if (b.maturity_date !== undefined) patch.maturity_date = b.maturity_date ? String(b.maturity_date) : null
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes).trim() : null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_investments')
    .update(patch, { count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Investimento não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_investments')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Investimento não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
