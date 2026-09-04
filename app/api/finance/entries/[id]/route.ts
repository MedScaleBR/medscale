import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole, type ApiSession } from '@/lib/session/api'
import { getFinanceCategoryTree, rootCategoryName } from '@/lib/finance/categories'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceEntryType } from '@/lib/finance/types'

// PATCH (editar) e DELETE de um lançamento manual. Exclusivo do owner, módulo
// 'finance' — mesmo guarda da rota-coleção. `type` não é editável: sai da linha
// existente.

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guard(req)
  if (g.error) return g.error
  const b = await req.json().catch(() => ({}))

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('finance_entries')
    .select('id, account_id, type, direction, category_id, subcategory_id, revenue_entry_id')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })
  if (existing.revenue_entry_id) {
    return NextResponse.json(
      { error: 'Lançamento gerido pelo ciclo de receita', code: 'revenue_mirror_locked' },
      { status: 409 }
    )
  }

  const type = existing.type as FinanceEntryType
  // Um lançamento existente pode apontar para uma categoria já arquivada — isso
  // é um valor legal aqui (a rota DELETE inclusive orienta a arquivar). Sem
  // includeArchived, editar o valor desse lançamento falharia a revalidação.
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId, { includeArchived: true })

  const patch: Database['public']['Tables']['finance_entries']['Update'] = {}
  if (b.entry_date !== undefined) patch.entry_date = String(b.entry_date)
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null
  if (b.amount !== undefined) patch.amount = Number(b.amount)
  if (b.direction !== undefined) patch.direction = b.direction === 'in' ? 'in' : 'out'
  if (b.category_id !== undefined) {
    patch.category_id = b.category_id ? String(b.category_id) : null
    // `category` (texto) acompanha `category_id` — snapshot do nome da raiz.
    // Só mexe quando o caller tocou em `category_id`.
    patch.category = rootCategoryName(tree, patch.category_id as string | null)
  }
  if (b.subcategory_id !== undefined) patch.subcategory_id = b.subcategory_id ? String(b.subcategory_id) : null
  if (b.workspace_id !== undefined && type === 'pj') {
    const wid = b.workspace_id ? String(b.workspace_id) : null
    if (wid) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id')
        .eq('id', wid)
        .eq('account_id', g.session.accountId)
        .maybeSingle()
      if (!ws) return NextResponse.json({ error: 'Unidade inválida', code: 'workspace_invalid' }, { status: 400 })
    }
    patch.workspace_id = wid
  }

  // Revalida categoria/subcategoria/direção com os valores finais — os que não
  // vieram no body caem para o que já está gravado, para pegar uma direção
  // nova que ficaria incoerente com uma categoria antiga (ou vice-versa). Data
  // não informada ganha um placeholder seguro que sempre valida.
  const nextDirection = (patch.direction as 'in' | 'out' | undefined) ?? existing.direction
  const nextCategoryId = b.category_id !== undefined ? (patch.category_id as string | null) : existing.category_id
  const nextSubcategoryId =
    b.subcategory_id !== undefined ? (patch.subcategory_id as string | null) : existing.subcategory_id
  const err = validateEntryInput(tree, {
    type,
    entryDate: (patch.entry_date as string) ?? '2026-01-01',
    amount: patch.amount !== undefined ? (patch.amount as number) : 1,
    categoryId: nextCategoryId,
    subcategoryId: nextSubcategoryId,
    direction: nextDirection,
  })
  if (err) {
    return NextResponse.json({ error: 'Alteração inválida', code: err.code }, { status: 400 })
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })
  const { error } = await supabase
    .from('finance_entries')
    .update(patch)
    .eq('id', id)
    .eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guard(req)
  if (g.error) return g.error
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('finance_entries')
    .select('id, revenue_entry_id')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (existing?.revenue_entry_id) {
    return NextResponse.json(
      { error: 'Lançamento gerido pelo ciclo de receita', code: 'revenue_mirror_locked' },
      { status: 409 }
    )
  }

  const { error, count } = await supabase
    .from('finance_entries')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
