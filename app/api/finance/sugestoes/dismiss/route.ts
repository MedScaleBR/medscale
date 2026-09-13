import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readPeriodMonth } from '@/lib/finance/api-guard'

// Descartar um alerta. O descarte é preso ao period_month: no mês seguinte a
// comparação é outra e o alerta volta a valer, então não existe "descartar para
// sempre" aqui.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const categoryId = b.category_id ? String(b.category_id) : ''
  const subcategoryId = b.subcategory_id ? String(b.subcategory_id) : null
  const period = readPeriodMonth(b.period_month)

  if (!categoryId) {
    return NextResponse.json({ error: 'Categoria obrigatória', code: 'category_required' }, { status: 400 })
  }
  if (!period) {
    return NextResponse.json({ error: 'Período inválido', code: 'period_invalid' }, { status: 400 })
  }

  const supabase = await createClient()
  // Descartar duas vezes o mesmo alerta é clique repetido, não erro: se já
  // existe, responde ok em vez de estourar o unique index.
  let existing = supabase
    .from('finance_suggestion_dismissals')
    .select('id')
    .eq('account_id', g.session.accountId)
    .eq('category_id', categoryId)
    .eq('period_month', period)
  existing = subcategoryId ? existing.eq('subcategory_id', subcategoryId) : existing.is('subcategory_id', null)
  const { data: current } = await existing.maybeSingle()
  if (current) return NextResponse.json({ ok: true })

  const { error } = await supabase.from('finance_suggestion_dismissals').insert({
    account_id: g.session.accountId,
    category_id: categoryId,
    subcategory_id: subcategoryId,
    period_month: period,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}

// DELETE — desfaz o descarte (o alerta volta a aparecer no mês).
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const params = req.nextUrl.searchParams
  const categoryId = params.get('category_id')
  const subcategoryId = params.get('subcategory_id')
  const period = readPeriodMonth(params.get('periodo'))
  if (!categoryId || !period) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios' }, { status: 400 })
  }

  const supabase = await createClient()
  let q = supabase
    .from('finance_suggestion_dismissals')
    .delete()
    .eq('account_id', g.session.accountId)
    .eq('category_id', categoryId)
    .eq('period_month', period)
  q = subcategoryId ? q.eq('subcategory_id', subcategoryId) : q.is('subcategory_id', null)

  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
