import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole, type ApiSession } from '@/lib/session/api'
import { getFinanceCategoryTree, type FinanceCategoryTree, type CategoryNode } from '@/lib/finance/categories'
import { validateCategoryShape } from '@/lib/finance/category-validation'

// PATCH (renomear / mover / reordenar / arquivar) e DELETE (só remove de
// verdade quando não há filhos nem lançamentos). Exclusivo do owner, módulo
// 'finance' — mesmo guarda da rota-coleção.

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

function findNode(tree: FinanceCategoryTree, id: string):
  { node: CategoryNode; kind: 'pf' | 'pj'; parentId: string | null } | null {
  for (const kind of ['pf', 'pj'] as const) {
    for (const root of tree[kind]) {
      if (root.id === id) return { node: root, kind, parentId: null }
      for (const child of root.children) if (child.id === id) return { node: child, kind, parentId: root.id }
    }
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params
  const g = await guard(req)
  if (g.error) return g.error
  const body = await req.json().catch(() => ({}))

  const supabase = await createClient()
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const found = findNode(tree, id)
  if (!found) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const nextName = body.name !== undefined ? String(body.name).trim() : found.node.name
  const nextParent =
    body.parent_id !== undefined ? (body.parent_id ? String(body.parent_id) : null) : found.parentId

  if (body.name !== undefined || body.parent_id !== undefined) {
    const err = validateCategoryShape(tree, {
      kind: found.kind, name: nextName, parentId: nextParent, nodeId: id,
    })
    if (err) return NextResponse.json({ error: 'Alteração inválida', code: err.code }, { status: 400 })
  }

  const patch: Database['public']['Tables']['finance_categories']['Update'] = {}
  if (body.name !== undefined) patch.name = nextName
  if (body.parent_id !== undefined) patch.parent_id = nextParent
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order)
  if (body.is_archived !== undefined) patch.is_archived = Boolean(body.is_archived)

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await supabase
    .from('finance_categories')
    .update(patch)
    .eq('id', id)
    .eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Arquivar/desarquivar raiz cascateia para as subcategorias.
  if (body.is_archived !== undefined && found.parentId === null && found.node.children.length > 0) {
    await supabase
      .from('finance_categories')
      .update({ is_archived: Boolean(body.is_archived) })
      .eq('account_id', g.session.accountId)
      .eq('parent_id', id)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params
  const g = await guard(req)
  if (g.error) return g.error

  const supabase = await createClient()
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })
  const found = findNode(tree, id)
  if (!found) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const childCount = found.node.children.length
  const { data: entryRefs } = await supabase
    .from('finance_entries')
    .select('id')
    .eq('account_id', g.session.accountId)
    .or(`category_id.eq.${id},subcategory_id.eq.${id}`)
  const entryCount = entryRefs?.length ?? 0

  if (childCount > 0 || entryCount > 0) {
    return NextResponse.json(
      { error: 'Categoria em uso — arquive em vez de excluir', code: 'in_use', children: childCount, entries: entryCount },
      { status: 409 }
    )
  }

  const { error } = await supabase.from('finance_categories').delete().eq('id', id).eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
