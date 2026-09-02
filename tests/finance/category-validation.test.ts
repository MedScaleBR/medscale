import { describe, it, expect } from 'vitest'
import { validateCategoryShape } from '@/lib/finance/category-validation'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
      { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] },
    ] },
    { id: 'ali', name: 'Alimentação', sortOrder: 1, isArchived: false, children: [] },
  ],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}

describe('validateCategoryShape', () => {
  it('aceita nova raiz com nome livre', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Pets', parentId: null })).toBeNull()
  })
  it('rejeita nome vazio', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: '   ', parentId: null })).toEqual({ code: 'empty_name' })
  })
  it('rejeita kind inválido', () => {
    expect(validateCategoryShape(TREE, { kind: 'xx', name: 'A', parentId: null })).toEqual({ code: 'kind_invalid' })
  })
  it('rejeita irmã duplicada (case/acento)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'alimentacao', parentId: null })).toEqual({ code: 'duplicate_sibling' })
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'ESCOLA', parentId: 'fil' })).toEqual({ code: 'duplicate_sibling' })
  })
  it('permite renomear o próprio nó para o mesmo nome (nodeId ignora a si)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Alimentação', parentId: null, nodeId: 'ali' })).toBeNull()
  })
  it('rejeita parent inexistente', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'nope' })).toEqual({ code: 'parent_not_found' })
  })
  it('rejeita parent que já é subcategoria (evita 3º nível)', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'esc' })).toEqual({ code: 'parent_not_root' })
  })
  it('rejeita parent de outro kind', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: 'alu' })).toEqual({ code: 'parent_kind_mismatch' })
  })
  it('rejeita mover um nó que tem filhos para virar subcategoria', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'Filhos', parentId: 'ali', nodeId: 'fil' })).toEqual({ code: 'would_orphan_children' })
  })
  it('rejeita PATCH de nó inexistente', () => {
    expect(validateCategoryShape(TREE, { kind: 'pf', name: 'X', parentId: null, nodeId: 'ghost' })).toEqual({ code: 'node_not_found' })
  })
})
