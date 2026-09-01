import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole, type ApiSession } from '@/lib/session/api'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceEntryType } from '@/lib/finance/types'

// Lançamento manual do financeiro pela tela. Exclusivo do owner (dado
// financeiro), módulo 'finance'. O servidor grava os campos-sentinela
// (`recorded_by_phone: 'web'`, `raw_message: '(lançado na tela)'`) — a coluna
// texto `category` fica null; o vínculo vai em `category_id`/`subcategory_id`.

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

// Body compartilhado entre POST e PATCH. `type` só no POST.
async function readEntryBody(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  return {
    type: b.type as FinanceEntryType | undefined,
    entryDate: b.entry_date ? String(b.entry_date) : undefined,
    description: b.description === undefined ? undefined : (b.description ? String(b.description) : null),
    amount: b.amount === undefined ? undefined : Number(b.amount),
    categoryId: b.category_id === undefined ? undefined : (b.category_id ? String(b.category_id) : null),
    subcategoryId: b.subcategory_id === undefined ? undefined : (b.subcategory_id ? String(b.subcategory_id) : null),
    workspaceId: b.workspace_id === undefined ? undefined : (b.workspace_id ? String(b.workspace_id) : null),
  }
}

async function workspaceBelongs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  workspaceId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('account_id', accountId)
    .maybeSingle()
  return !!data
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guard(req)
  if (g.error) return g.error
  const b = await readEntryBody(req)

  if (b.type !== 'pf' && b.type !== 'pj') {
    return NextResponse.json({ error: "type deve ser 'pf' ou 'pj'" }, { status: 400 })
  }
  const supabase = await createClient()
  await ensureFinanceCategories(supabase, g.session.accountId)
  const tree = await getFinanceCategoryTree(supabase, g.session.accountId)

  const err = validateEntryInput(tree, {
    type: b.type,
    entryDate: b.entryDate ?? '',
    amount: b.amount ?? NaN,
    categoryId: b.categoryId ?? null,
    subcategoryId: b.subcategoryId ?? null,
  })
  if (err) return NextResponse.json({ error: 'Lançamento inválido', code: err.code }, { status: 400 })

  if (b.type === 'pj' && b.workspaceId) {
    if (!(await workspaceBelongs(supabase, g.session.accountId, b.workspaceId))) {
      return NextResponse.json({ error: 'Unidade inválida', code: 'workspace_invalid' }, { status: 400 })
    }
  }

  const payload: Database['public']['Tables']['finance_entries']['Insert'] = {
    account_id: g.session.accountId,
    workspace_id: b.type === 'pj' ? b.workspaceId ?? null : null,
    recorded_by_phone: 'web',
    type: b.type,
    description: b.description ?? null,
    amount: b.amount as number,
    category: null,
    category_id: b.categoryId ?? null,
    subcategory_id: b.subcategoryId ?? null,
    raw_message: '(lançado na tela)',
    entry_date: b.entryDate as string,
  }

  const { data, error } = await supabase
    .from('finance_entries')
    .insert(payload)
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
