import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole, type ApiSession } from '@/lib/session/api'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree, type CategoryNode } from '@/lib/finance/categories'
import { validateCategoryShape } from '@/lib/finance/category-validation'

// CRUD da árvore de categorias do financeiro. Exclusivo do owner (dado
// financeiro), módulo 'finance'. Escrita com createClient() — a policy
// "finance_categories: owner only" é o guarda.

type GuardResult =
  | { error: NextResponse; session?: never }
  | { error?: never; session: ApiSession }

async function guard(req: NextRequest): Promise<GuardResult> {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return { error: result.error }
  const mod = requireModule(result.session, 'finance')
  if (mod) return { error: mod }
  const role = requireRole(result.session, ['owner'])
  if (role) return { error: role }
  return { session: result.session }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guard(req)
  if (g.error) return g.error
  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)

  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const { data: refs } = await supabase
    .from('finance_entries')
    .select('category_id, subcategory_id')
    .eq('account_id', g.session.accountId)

  const counts = new Map<string, number>()
  for (const r of (refs ?? []) as Array<{ category_id: string | null; subcategory_id: string | null }>) {
    for (const id of [r.category_id, r.subcategory_id]) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const withCounts = (nodes: CategoryNode[]): (CategoryNode & { entryCount: number })[] =>
    nodes.map((n) => ({ ...n, entryCount: counts.get(n.id) ?? 0, children: withCounts(n.children) }))

  const kind = new URL(req.url).searchParams.get('kind')
  const out = { pf: withCounts(tree.pf), pj: withCounts(tree.pj) }
  if (kind === 'pf' || kind === 'pj') return NextResponse.json({ [kind]: out[kind] })
  return NextResponse.json(out)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guard(req)
  if (g.error) return g.error
  const body = await req.json().catch(() => ({}))
  const kind = String(body.kind ?? '')
  const name = String(body.name ?? '').trim()
  const parentId = body.parent_id ? String(body.parent_id) : null

  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })

  const err = validateCategoryShape(tree, { kind, name, parentId })
  if (err) return NextResponse.json({ error: 'Categoria inválida', code: err.code }, { status: 400 })

  // sort_order = fim da lista de irmãs
  const siblings = parentId
    ? (tree[kind as 'pf' | 'pj'].find((c) => c.id === parentId)?.children ?? [])
    : tree[kind as 'pf' | 'pj']
  const sortOrder = siblings.length

  const { data, error } = await supabase
    .from('finance_categories')
    .insert({ account_id: g.session.accountId, kind: kind as 'pf' | 'pj', parent_id: parentId, name, sort_order: sortOrder })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
