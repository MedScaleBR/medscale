import { describe, it, expect } from 'vitest'
import { createSupabaseMock } from '../helpers/supabase-mock'
import { getFinanceCategoryTree, resolveCategoryPair, type FinanceCategoryTree } from '@/lib/finance/categories'

const ROWS = [
  { id: 'pf-fil', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'pf-esc', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: 'pf-fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'pf-ali', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null, name: 'Alimentação', sort_order: 1, is_archived: false, created_at: '' },
  { id: 'pf-old', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null, name: 'Antiga', sort_order: 2, is_archived: true, created_at: '' },
  { id: 'pj-alu', account_id: 'a1', kind: 'pj', direction: 'out', parent_id: null, name: 'Aluguel', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'pj-rec', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]

describe('getFinanceCategoryTree', () => {
  it('monta as árvores pf/pj aninhadas, sem arquivadas por padrão', async () => {
    const mock = createSupabaseMock({ finance_categories: { select: { data: ROWS } } })
    const tree = await getFinanceCategoryTree(mock.client as never, 'a1')
    expect(tree.pf.map((c) => c.name)).toEqual(['Filhos', 'Alimentação'])
    expect(tree.pf[0].children.map((c) => c.name)).toEqual(['Escola'])
    expect(tree.pj.map((c) => c.name)).toEqual(['Aluguel', 'Consultas particulares'])
  })
  it('inclui arquivadas quando opts.includeArchived', async () => {
    const mock = createSupabaseMock({ finance_categories: { select: { data: ROWS } } })
    const tree = await getFinanceCategoryTree(mock.client as never, 'a1', { includeArchived: true })
    expect(tree.pf.map((c) => c.name)).toContain('Antiga')
  })
  it('cada nó carrega o direction da linha', async () => {
    const mock = createSupabaseMock({ finance_categories: { select: { data: ROWS } } })
    const tree = await getFinanceCategoryTree(mock.client as never, 'a1')
    expect(tree.pj.find((c) => c.id === 'pj-alu')!.direction).toBe('out')
    expect(tree.pj.find((c) => c.id === 'pj-rec')!.direction).toBe('in')
    expect(tree.pf.find((c) => c.id === 'pf-fil')!.children[0].direction).toBe('out')
  })
})

const TREE: FinanceCategoryTree = {
  pf: [{ id: 'pf-fil', name: 'Filhos', direction: 'out', sortOrder: 0, isArchived: false, children: [
        { id: 'pf-esc', name: 'Escola', direction: 'out', sortOrder: 0, isArchived: false, children: [] }] }],
  pj: [
    { id: 'pj-alu', name: 'Aluguel', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    { id: 'pj-rec', name: 'Outras receitas', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
    { id: 'pj-rec-out', name: 'Outras receitas', direction: 'out', sortOrder: 1, isArchived: false, children: [] },
  ],
}

describe('resolveCategoryPair', () => {
  it('casa categoria e subcategoria por nome sem acento/caixa', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'FILHOS', 'escola')).toEqual({
      categoryId: 'pf-fil', categoryName: 'Filhos', subcategoryId: 'pf-esc', subcategoryName: 'Escola',
    })
  })
  it('ignora subcategoria que não pertence à categoria resolvida', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'Filhos', 'Aluguel')).toEqual({
      categoryId: 'pf-fil', categoryName: 'Filhos', subcategoryId: null, subcategoryName: null,
    })
  })
  it('nada casa → tudo null', () => {
    expect(resolveCategoryPair(TREE, 'pf', 'Inexistente', null)).toEqual({
      categoryId: null, categoryName: null, subcategoryId: null, subcategoryName: null,
    })
  })
  it('respeita o kind (pj não acha categoria pf)', () => {
    expect(resolveCategoryPair(TREE, 'pj', 'Filhos', null).categoryId).toBeNull()
  })
  it('type null: procura em pf e depois pj', () => {
    expect(resolveCategoryPair(TREE, null, 'Aluguel', null).categoryId).toBe('pj-alu')
  })
  it('filtra pela direção — default out', () => {
    expect(resolveCategoryPair(TREE, 'pj', 'Outras receitas', null).categoryId).toBe('pj-rec-out')
  })
  it('filtra pela direção — in explícito', () => {
    expect(resolveCategoryPair(TREE, 'pj', 'Outras receitas', null, 'in').categoryId).toBe('pj-rec')
  })
})
