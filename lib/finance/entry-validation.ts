import type { FinanceCategoryTree, CategoryNode } from './categories'
import type { FinanceEntryType } from './types'

export type EntryValidationError =
  | { code: 'amount_invalid' }
  | { code: 'date_invalid' }
  | { code: 'category_not_found' }
  | { code: 'subcategory_not_found' }
  | { code: 'category_kind_mismatch' }
  | { code: 'subcategory_not_child' }

export interface EntryInput {
  type: FinanceEntryType
  entryDate: string
  amount: number
  categoryId: string | null
  subcategoryId: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function findRoot(tree: FinanceCategoryTree, id: string): { node: CategoryNode; kind: FinanceEntryType } | null {
  for (const kind of ['pf', 'pj'] as const) {
    const hit = tree[kind].find((c) => c.id === id)
    if (hit) return { node: hit, kind }
  }
  return null
}

// Valida um lançamento manual (rota) ou editado. Não checa workspace_id — isso
// exige query e fica na rota.
export function validateEntryInput(
  tree: FinanceCategoryTree,
  input: EntryInput
): EntryValidationError | null {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { code: 'amount_invalid' }
  if (!ISO_DATE.test(input.entryDate) || Number.isNaN(Date.parse(input.entryDate))) {
    return { code: 'date_invalid' }
  }

  let root: { node: CategoryNode; kind: FinanceEntryType } | null = null
  if (input.categoryId) {
    root = findRoot(tree, input.categoryId)
    if (!root) return { code: 'category_not_found' }
    if (root.kind !== input.type) return { code: 'category_kind_mismatch' }
  }

  if (input.subcategoryId) {
    if (!root) return { code: 'subcategory_not_child' }
    const child = root.node.children.find((s) => s.id === input.subcategoryId)
    if (!child) {
      // existe em algum lugar? erro mais específico
      const anywhere = ['pf', 'pj'].some((k) =>
        tree[k as FinanceEntryType].some((c) => c.id === input.subcategoryId || c.children.some((s) => s.id === input.subcategoryId))
      )
      return anywhere ? { code: 'subcategory_not_child' } : { code: 'subcategory_not_found' }
    }
  }

  return null
}
