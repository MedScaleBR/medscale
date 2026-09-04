import type { FinanceCategoryTree, CategoryNode } from './categories'
import { normalizeCategoryName } from './default-categories'
import type { FinanceEntryType } from './types'

export type CategoryValidationError =
  | { code: 'empty_name' }
  | { code: 'kind_invalid' }
  | { code: 'parent_not_found' }
  | { code: 'parent_not_root' }
  | { code: 'parent_kind_mismatch' }
  | { code: 'parent_direction_mismatch' }
  | { code: 'duplicate_sibling' }
  | { code: 'would_orphan_children' }
  | { code: 'node_not_found' }

interface Flat { node: CategoryNode; kind: FinanceEntryType; parentId: string | null }

function flatten(tree: FinanceCategoryTree): Flat[] {
  const out: Flat[] = []
  for (const kind of ['pf', 'pj'] as const) {
    for (const root of tree[kind]) {
      out.push({ node: root, kind, parentId: null })
      for (const child of root.children) out.push({ node: child, kind, parentId: root.id })
    }
  }
  return out
}

// Valida a forma de uma categoria/subcategoria antes de criar (sem nodeId) ou
// editar (com nodeId). Não toca o banco — a rota resolve a árvore antes.
export function validateCategoryShape(
  tree: FinanceCategoryTree,
  input: { kind: string; direction: 'in' | 'out'; name: string; parentId: string | null; nodeId?: string }
): CategoryValidationError | null {
  if (input.kind !== 'pf' && input.kind !== 'pj') return { code: 'kind_invalid' }
  const name = input.name?.trim() ?? ''
  if (!name) return { code: 'empty_name' }

  const flat = flatten(tree)

  if (input.nodeId && !flat.some((f) => f.node.id === input.nodeId)) {
    return { code: 'node_not_found' }
  }

  if (input.parentId) {
    const parent = flat.find((f) => f.node.id === input.parentId)
    if (!parent) return { code: 'parent_not_found' }
    if (parent.parentId !== null) return { code: 'parent_not_root' }
    if (parent.kind !== input.kind) return { code: 'parent_kind_mismatch' }
    if (parent.node.direction !== input.direction) return { code: 'parent_direction_mismatch' }
  }

  if (input.nodeId && input.parentId) {
    const self = flat.find((f) => f.node.id === input.nodeId)
    if (self && self.node.children.length > 0) return { code: 'would_orphan_children' }
  }

  const target = normalizeCategoryName(name)
  const siblingClash = flat.some(
    (f) =>
      f.kind === input.kind &&
      f.node.direction === input.direction &&
      f.parentId === (input.parentId ?? null) &&
      f.node.id !== input.nodeId &&
      normalizeCategoryName(f.node.name) === target
  )
  if (siblingClash) return { code: 'duplicate_sibling' }

  return null
}
