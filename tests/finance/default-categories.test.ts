import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FINANCE_CATEGORIES,
  normalizeCategoryName,
  buildProvisionPayload,
} from '@/lib/finance/default-categories'

describe('normalizeCategoryName', () => {
  it('remove acento, caixa e espaços de sobra', () => {
    expect(normalizeCategoryName('  Alimentação ')).toBe('alimentacao')
    expect(normalizeCategoryName('Impostos  e   Taxas')).toBe('impostos e taxas')
    expect(normalizeCategoryName('SAÚDE')).toBe('saude')
  })
  it('trata null/undefined como string vazia', () => {
    expect(normalizeCategoryName(undefined as unknown as string)).toBe('')
  })
})

describe('DEFAULT_FINANCE_CATEGORIES', () => {
  it('tem raízes em pf e pj, todas com children array', () => {
    expect(DEFAULT_FINANCE_CATEGORIES.pf.length).toBeGreaterThan(5)
    expect(DEFAULT_FINANCE_CATEGORIES.pj.length).toBeGreaterThan(5)
    for (const kind of ['pf', 'pj'] as const) {
      for (const cat of DEFAULT_FINANCE_CATEGORIES[kind]) {
        expect(typeof cat.name).toBe('string')
        expect(Array.isArray(cat.children)).toBe(true)
      }
    }
  })
  it('não tem irmãs com nome normalizado duplicado', () => {
    for (const kind of ['pf', 'pj'] as const) {
      const roots = DEFAULT_FINANCE_CATEGORIES[kind].map((c) => normalizeCategoryName(c.name))
      expect(new Set(roots).size).toBe(roots.length)
      for (const cat of DEFAULT_FINANCE_CATEGORIES[kind]) {
        const subs = cat.children.map(normalizeCategoryName)
        expect(new Set(subs).size).toBe(subs.length)
      }
    }
  })
  it('inclui as raízes das constantes antigas para o backfill casar', () => {
    const pf = DEFAULT_FINANCE_CATEGORIES.pf.map((c) => c.name)
    expect(pf).toEqual(expect.arrayContaining(['Alimentação', 'Moradia', 'Saúde', 'Transporte', 'Lazer', 'Investimentos', 'Outros']))
    const pj = DEFAULT_FINANCE_CATEGORIES.pj.map((c) => c.name)
    expect(pj).toEqual(expect.arrayContaining(['Aluguel', 'Marketing', 'Impostos', 'Outros']))
  })
})

describe('buildProvisionPayload', () => {
  it('devolve a árvore com children sempre presente', () => {
    const p = buildProvisionPayload()
    for (const kind of ['pf', 'pj'] as const) {
      for (const cat of p[kind]) expect(Array.isArray(cat.children)).toBe(true)
    }
  })
})
