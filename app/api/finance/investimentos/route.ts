import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readAmount, readInvestmentType, readRateType } from '@/lib/finance/api-guard'
import { calculateInvestmentProjection } from '@/lib/finance/investments'
import type { FinanceEntryType } from '@/lib/finance/types'

// Investimentos da conta. A projeção não é coluna: vem calculada na leitura por
// calculateInvestmentProjection, que devolve null quando faltam rate_type/
// rate_value/start_date — nunca um rendimento chutado.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind = kindParam === 'pf' || kindParam === 'pj' ? (kindParam as FinanceEntryType) : null

  const supabase = await createClient()
  let q = supabase
    .from('finance_investments')
    .select('*')
    .eq('account_id', g.session.accountId)
    .order('created_at', { ascending: true })
  if (kind) q = q.eq('kind', kind)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const investments = (data ?? []).map((inv) => ({
    ...inv,
    projection: calculateInvestmentProjection(inv),
  }))
  return NextResponse.json({ investments })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })

  const type = readInvestmentType(b.type)
  if (!type) return NextResponse.json({ error: 'Tipo inválido', code: 'type_invalid' }, { status: 400 })

  const invested = readAmount(b.invested_amount)
  if (invested == null) {
    return NextResponse.json({ error: 'Valor investido inválido', code: 'amount_invalid' }, { status: 400 })
  }

  // Taxa é tudo-ou-nada: rate_type sem rate_value (ou o contrário) geraria uma
  // projeção sem base. Sem os dois, o investimento fica só com valor atual.
  const rateType = b.rate_type ? readRateType(b.rate_type) : null
  if (b.rate_type && !rateType) {
    return NextResponse.json({ error: 'Tipo de taxa inválido', code: 'rate_type_invalid' }, { status: 400 })
  }
  const rateValue = rateType ? readAmount(b.rate_value) : null
  if (rateType && rateValue == null) {
    return NextResponse.json({ error: 'Taxa obrigatória para o tipo escolhido', code: 'rate_value_required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('finance_investments')
    .insert({
      account_id: g.session.accountId,
      kind: b.kind === 'pj' ? 'pj' : 'pf',
      name,
      type,
      invested_amount: invested,
      current_value: b.current_value != null ? readAmount(b.current_value) : null,
      rate_type: rateType,
      rate_value: rateValue,
      ...(b.start_date ? { start_date: String(b.start_date) } : {}),
      maturity_date: b.maturity_date ? String(b.maturity_date) : null,
      notes: b.notes ? String(b.notes).trim() : null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
