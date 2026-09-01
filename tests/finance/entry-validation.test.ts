import { describe, it, expect } from 'vitest'
import { validateEntryInput } from '@/lib/finance/entry-validation'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [{ id: 'fil', name: 'Filhos', sortOrder: 0, isArchived: false, children: [
        { id: 'esc', name: 'Escola', sortOrder: 0, isArchived: false, children: [] }] }],
  pj: [{ id: 'alu', name: 'Aluguel', sortOrder: 0, isArchived: false, children: [] }],
}
const base = { type: 'pf' as const, entryDate: '2026-09-01', amount: 100, categoryId: null, subcategoryId: null }

describe('validateEntryInput', () => {
  it('aceita lançamento sem categoria', () => {
    expect(validateEntryInput(TREE, base)).toBeNull()
  })
  it('aceita categoria + subcategoria coerentes', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'fil', subcategoryId: 'esc' })).toBeNull()
  })
  it('rejeita valor <= 0 ou não finito', () => {
    expect(validateEntryInput(TREE, { ...base, amount: 0 })).toEqual({ code: 'amount_invalid' })
    expect(validateEntryInput(TREE, { ...base, amount: Number.NaN })).toEqual({ code: 'amount_invalid' })
  })
  it('rejeita data fora de YYYY-MM-DD', () => {
    expect(validateEntryInput(TREE, { ...base, entryDate: '01/09/2026' })).toEqual({ code: 'date_invalid' })
  })
  it('rejeita category_id inexistente', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'ghost' })).toEqual({ code: 'category_not_found' })
  })
  it('rejeita categoria de kind diferente do type', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'alu' })).toEqual({ code: 'category_kind_mismatch' })
  })
  it('rejeita subcategoria que não é filha da categoria', () => {
    expect(validateEntryInput(TREE, { ...base, categoryId: 'fil', subcategoryId: 'alu' })).toEqual({ code: 'subcategory_not_child' })
  })
  it('rejeita subcategoria sem categoria', () => {
    expect(validateEntryInput(TREE, { ...base, subcategoryId: 'esc' })).toEqual({ code: 'subcategory_not_child' })
  })
})
