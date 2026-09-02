import { describe, it, expect } from 'vitest'
import { buildCategorizePrompt } from '@/lib/finance/categorize'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
      { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] },
    ] },
    { id: 'arq', name: 'Arquivada', sortOrder: 1, isArchived: true, children: [] },
    { id: 'out', name: 'Outros', sortOrder: 2, isArchived: false, children: [] },
  ],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}

describe('buildCategorizePrompt', () => {
  it('lista Categoria > Subcategoria e raízes sozinhas, sem arquivadas', () => {
    const p = buildCategorizePrompt('pf', TREE)
    expect(p).toContain('Filhos > Escola')
    expect(p).toContain('Filhos')
    expect(p).toContain('Outros')
    expect(p).not.toContain('Arquivada')
  })
  it('usa o kind certo', () => {
    expect(buildCategorizePrompt('pj', TREE)).toContain('Aluguel')
    expect(buildCategorizePrompt('pj', TREE)).not.toContain('Filhos')
  })
})
