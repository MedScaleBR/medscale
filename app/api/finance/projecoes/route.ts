import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readPeriodMonth } from '@/lib/finance/api-guard'
import { getFinanceCategoryTree, type FinanceCategoryTree, type CategoryNode } from '@/lib/finance/categories'
import type { FinanceEntryType } from '@/lib/finance/types'

// Gasto planejado por categoria/subcategoria num mês. Uma linha por
// (categoria, subcategoria, mês) — o unique index cuida disso e o PUT faz
// upsert, então reeditar o mesmo mês sobrescreve em vez de duplicar.

function findCategory(
  tree: FinanceCategoryTree,
  id: string
): { node: CategoryNode; kind: FinanceEntryType; parent: CategoryNode | null } | null {
  for (const kind of ['pf', 'pj'] as const) {
    for (const root of tree[kind]) {
      if (root.id === id) return { node: root, kind, parent: null }
      for (const child of root.children) {
        if (child.id === id) return { node: child, kind, parent: root }
      }
    }
  }
  return null
}

// GET /api/finance/projecoes?periodo=2026-09&kind=pf
export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const period = readPeriodMonth(req.nextUrl.searchParams.get('periodo'))
  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind = kindParam === 'pf' || kindParam === 'pj' ? (kindParam as FinanceEntryType) : null

  const supabase = await createClient()
  let q = supabase
    .from('finance_projections')
    .select('*')
    .eq('account_id', g.session.accountId)
  if (period) q = q.eq('period_month', period)
  // A projeção não guarda PF/PJ: o lado vem da categoria, que já é de um kind
  // só. Filtrar por ids evita uma coluna redundante que poderia divergir.
  if (kind) {
    const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
    const ids = tree[kind].flatMap((root) => [root.id, ...root.children.map((c) => c.id)])
    if (ids.length === 0) return NextResponse.json({ projections: [] })
    q = q.in('category_id', ids)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projections: data ?? [] })
}

// PUT /api/finance/projecoes — cria ou atualiza a projeção de uma categoria no
// mês. Aceita 0 (planejar não gastar nada); para remover a linha, DELETE.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const period = readPeriodMonth(b.period_month)
  if (!period) return NextResponse.json({ error: 'Período inválido', code: 'period_invalid' }, { status: 400 })

  const amount = Number(b.projected_amount)
  if (!isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'Valor inválido', code: 'amount_invalid' }, { status: 400 })
  }

  const categoryId = b.category_id ? String(b.category_id) : ''
  const subcategoryId = b.subcategory_id ? String(b.subcategory_id) : null
  if (!categoryId) {
    return NextResponse.json({ error: 'Categoria obrigatória', code: 'category_required' }, { status: 400 })
  }

  const supabase = await createClient()
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })

  const cat = findCategory(tree, categoryId)
  if (!cat || cat.parent) {
    return NextResponse.json({ error: 'Categoria inválida', code: 'category_invalid' }, { status: 400 })
  }
  // Projeção é de gasto: categoria de entrada aqui seria comparada contra um
  // "realizado" de receita e viraria alerta sem sentido nas sugestões.
  if (cat.node.direction !== 'out') {
    return NextResponse.json({ error: 'Só categorias de saída têm projeção', code: 'direction_invalid' }, { status: 400 })
  }
  if (subcategoryId) {
    const sub = findCategory(tree, subcategoryId)
    if (!sub || sub.parent?.id !== categoryId) {
      return NextResponse.json({ error: 'Subcategoria inválida', code: 'subcategory_invalid' }, { status: 400 })
    }
  }

  // Upsert na mão: o índice único usa coalesce(subcategory_id, uuid-zero)
  // (NULL nunca conflita com NULL em UNIQUE), e um conflict target de expressão
  // não é expressável no `onConflict` do supabase-js.
  let existing = supabase
    .from('finance_projections')
    .select('id')
    .eq('account_id', g.session.accountId)
    .eq('category_id', categoryId)
    .eq('period_month', period)
  existing = subcategoryId ? existing.eq('subcategory_id', subcategoryId) : existing.is('subcategory_id', null)
  const { data: current } = await existing.maybeSingle()

  if (current) {
    const { error } = await supabase
      .from('finance_projections')
      .update({ projected_amount: amount })
      .eq('id', current.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: current.id })
  }

  const { data, error } = await supabase
    .from('finance_projections')
    .insert({
      account_id: g.session.accountId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      period_month: period,
      projected_amount: amount,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}

// DELETE /api/finance/projecoes?id=<uuid>
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_projections')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Projeção não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
