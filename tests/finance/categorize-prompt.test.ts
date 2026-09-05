import { describe, it, expect } from 'vitest'
import { buildCategorizePrompt } from '@/lib/finance/categorize'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'fil', name: 'Filhos', direction: 'out', sortOrder: 0, isArchived: false, children: [
      { id: 'esc', name: 'Escola', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    ] },
    { id: 'arq', name: 'Arquivada', direction: 'out', sortOrder: 1, isArchived: true, children: [] },
    { id: 'out', name: 'Outros', direction: 'out', sortOrder: 2, isArchived: false, children: [] },
    { id: 'sal', name: 'Salário / Pró-labore', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
  ],
  pj: [
    { id: 'alu', name: 'Aluguel', direction: 'out', sortOrder: 0, isArchived: false, children: [] },
    { id: 'rec', name: 'Consultas particulares', direction: 'in', sortOrder: 0, isArchived: false, children: [] },
  ],
}

describe('buildCategorizePrompt', () => {
  it('lista Categoria > Subcategoria e raízes sozinhas, sem arquivadas (despesa)', () => {
    const p = buildCategorizePrompt('pf', 'out', TREE)
    expect(p).toContain('Filhos > Escola')
    expect(p).toContain('Filhos')
    expect(p).toContain('Outros')
    expect(p).not.toContain('Arquivada')
    expect(p).not.toContain('Salário / Pró-labore')
  })
  it('usa o kind certo', () => {
    expect(buildCategorizePrompt('pj', 'out', TREE)).toContain('Aluguel')
    expect(buildCategorizePrompt('pj', 'out', TREE)).not.toContain('Filhos')
  })
  it('filtra pela direção — só categorias de receita quando direction=in', () => {
    const p = buildCategorizePrompt('pf', 'in', TREE)
    expect(p).toContain('Salário / Pró-labore')
    expect(p).not.toContain('Filhos')
    expect(p).not.toContain('Outros')
  })
  it('receita PJ', () => {
    const p = buildCategorizePrompt('pj', 'in', TREE)
    expect(p).toContain('Consultas particulares')
    expect(p).not.toContain('Aluguel')
  })
})
