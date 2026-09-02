import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FinanceEntryType } from './types'
import { normalizeCategoryName } from './default-categories'

export interface CategoryNode {
  id: string
  name: string
  sortOrder: number
  isArchived: boolean
  children: CategoryNode[]
}
export interface FinanceCategoryTree {
  pf: CategoryNode[]
  pj: CategoryNode[]
}

type Row = Database['public']['Tables']['finance_categories']['Row']

// Lê finance_categories da conta e devolve as duas árvores aninhadas (2
// níveis), ordenadas por sort_order. Arquivadas ficam de fora salvo
// opts.includeArchived (o gerenciador na tela usa true para o modo "mostrar
// arquivadas").
export async function getFinanceCategoryTree(
  client: SupabaseClient<Database>,
  accountId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<FinanceCategoryTree> {
  let q = client
    .from('finance_categories')
    .select('id, account_id, kind, parent_id, name, sort_order, is_archived, created_at')
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
  if (!opts.includeArchived) q = q.eq('is_archived', false)
  const { data } = await q
  const rows = ((data ?? []) as Row[]).filter((r) => opts.includeArchived || !r.is_archived)
  return buildTree(rows)
}

function buildTree(rows: Row[]): FinanceCategoryTree {
  const node = (r: Row): CategoryNode => ({
    id: r.id, name: r.name, sortOrder: r.sort_order, isArchived: r.is_archived, children: [],
  })
  const make = (kind: FinanceEntryType): CategoryNode[] => {
    const ofKind = rows.filter((r) => r.kind === kind)
    const roots = ofKind.filter((r) => r.parent_id === null).map(node)
    const byId = new Map(roots.map((n) => [n.id, n]))
    for (const r of ofKind.filter((r) => r.parent_id !== null)) {
      const parent = byId.get(r.parent_id as string)
      if (parent) parent.children.push(node(r))
    }
    const bySort = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder
    roots.sort(bySort)
    for (const root of roots) root.children.sort(bySort)
    return roots
  }
  return { pf: make('pf'), pj: make('pj') }
}

// Nome da categoria-raiz de um id (qualquer kind). As rotas web usam isto para
// gravar o snapshot textual em finance_entries.category, do mesmo jeito que o
// agente do WhatsApp já faz. null quando o id é null ou não está na árvore.
export function rootCategoryName(
  tree: FinanceCategoryTree,
  categoryId: string | null
): string | null {
  if (!categoryId) return null
  for (const kind of ['pf', 'pj'] as const) {
    const hit = tree[kind].find((c) => c.id === categoryId)
    if (hit) return hit.name
  }
  return null
}

export interface ResolvedCategoryPair {
  categoryId: string | null
  categoryName: string | null
  subcategoryId: string | null
  subcategoryName: string | null
}

const EMPTY: ResolvedCategoryPair = {
  categoryId: null, categoryName: null, subcategoryId: null, subcategoryName: null,
}

// Casa nomes (possivelmente vindos do modelo) contra a árvore da conta.
// type null tenta pf e depois pj. Subcategoria só resolve se for filha da
// categoria resolvida.
export function resolveCategoryPair(
  tree: FinanceCategoryTree,
  type: FinanceEntryType | null,
  categoryName: string | null,
  subcategoryName: string | null
): ResolvedCategoryPair {
  if (!categoryName) return EMPTY
  const kinds: FinanceEntryType[] = type ? [type] : ['pf', 'pj']
  const target = normalizeCategoryName(categoryName)
  for (const kind of kinds) {
    const cat = tree[kind].find((c) => normalizeCategoryName(c.name) === target)
    if (!cat) continue
    let subId: string | null = null
    let subName: string | null = null
    if (subcategoryName) {
      const sub = cat.children.find(
        (s) => normalizeCategoryName(s.name) === normalizeCategoryName(subcategoryName)
      )
      if (sub) { subId = sub.id; subName = sub.name }
    }
    return { categoryId: cat.id, categoryName: cat.name, subcategoryId: subId, subcategoryName: subName }
  }
  return EMPTY
}
