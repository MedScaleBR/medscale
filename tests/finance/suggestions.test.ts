import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TOLERANCE,
  calculateSuggestions,
  type SuggestionCategory,
  type SuggestionContext,
} from '@/lib/finance/suggestions'
import type { FinanceEntry, FinanceProjection } from '@/lib/finance/types'

function entry(partial: Partial<FinanceEntry> & { amount: number; entry_date: string }): FinanceEntry {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'a1',
    workspace_id: null,
    recorded_by_phone: 'web',
    type: 'pf',
    direction: 'out',
    description: null,
    category: null,
    category_id: 'lazer',
    subcategory_id: null,
    raw_message: '',
    revenue_entry_id: null,
    created_at: '',
    ...partial,
  } as FinanceEntry
}

function category(partial: Partial<SuggestionCategory> = {}): SuggestionCategory {
  return {
    id: 'lazer',
    name: 'Lazer',
    parentId: null,
    direction: 'out',
    isEssential: false,
    ...partial,
  }
}

function projection(partial: Partial<FinanceProjection> = {}): FinanceProjection {
  return {
    id: 'p1',
    account_id: 'a1',
    category_id: 'lazer',
    subcategory_id: null,
    period_month: '2026-09-01',
    projected_amount: 500,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

function ctx(partial: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    periodMonth: '2026-09',
    entries: [],
    historicalEntries: [],
    projections: [],
    categories: [category()],
    tolerance: DEFAULT_TOLERANCE,
    dismissals: [],
    ...partial,
  }
}

describe('calculateSuggestions — caminho da projeção', () => {
  it('alerta quando o realizado passa da projeção', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 800, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 500 })],
      })
    )
    expect(s).toHaveLength(1)
    expect(s[0].referenceType).toBe('projection')
    expect(s[0].referenceAmount).toBe(500)
    expect(s[0].realizedAmount).toBe(800)
    expect(s[0].overAmount).toBe(300)
    expect(s[0].overPct).toBeCloseTo(60, 5)
  })

  it('não alerta quando o realizado fica dentro da projeção', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 400, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 500 })],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('respeita a tolerância configurada', () => {
    const base = {
      entries: [entry({ amount: 540, entry_date: '2026-09-05' })],
      projections: [projection({ projected_amount: 500 })],
    }
    expect(calculateSuggestions(ctx(base))).toHaveLength(1)
    expect(
      calculateSuggestions(
        ctx({ ...base, tolerance: { projectionPct: 20, historyPct: 30 } })
      )
    ).toHaveLength(0)
  })

  it('a projeção tem prioridade sobre a média histórica', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 800, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 500 })],
        historicalEntries: [
          entry({ amount: 1000, entry_date: '2026-08-05' }),
          entry({ amount: 1000, entry_date: '2026-07-05' }),
        ],
      })
    )
    expect(s[0].referenceType).toBe('projection')
  })

  it('projeção zerada com gasto lançado alerta sem dividir por zero', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 120, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 0 })],
      })
    )
    expect(s).toHaveLength(1)
    expect(Number.isFinite(s[0].overPct)).toBe(true)
  })
})

describe('calculateSuggestions — caminho da média histórica', () => {
  it('alerta quando o mês passa da média dos meses anteriores', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 900, entry_date: '2026-09-05' })],
        historicalEntries: [
          entry({ amount: 400, entry_date: '2026-08-05' }),
          entry({ amount: 600, entry_date: '2026-07-05' }),
        ],
      })
    )
    expect(s).toHaveLength(1)
    expect(s[0].referenceType).toBe('history_average')
    expect(s[0].referenceAmount).toBe(500)
    expect(s[0].overAmount).toBe(400)
  })

  it('não alerta quando o excesso cabe na tolerância de 30%', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 600, entry_date: '2026-09-05' })],
        historicalEntries: [
          entry({ amount: 500, entry_date: '2026-08-05' }),
          entry({ amount: 500, entry_date: '2026-07-05' }),
        ],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('a média divide pelos meses COM gasto, não por 3 fixo', () => {
    // 400 e 600 em dois meses; o terceiro mês sem nada não é "mês barato",
    // é ausência de dado. Média = 500, não 333.
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 800, entry_date: '2026-09-05' })],
        historicalEntries: [
          entry({ amount: 400, entry_date: '2026-08-05' }),
          entry({ amount: 600, entry_date: '2026-07-05' }),
        ],
      })
    )
    expect(s[0].referenceAmount).toBe(500)
  })

  it('soma vários lançamentos do mesmo mês antes de tirar a média', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 900, entry_date: '2026-09-05' })],
        historicalEntries: [
          entry({ amount: 200, entry_date: '2026-08-05' }),
          entry({ amount: 200, entry_date: '2026-08-20' }),
          entry({ amount: 600, entry_date: '2026-07-05' }),
        ],
      })
    )
    expect(s[0].referenceAmount).toBe(500)
  })
})

describe('calculateSuggestions — sem base de comparação', () => {
  it('não alerta com menos de 2 meses de histórico e sem projeção', () => {
    const s = calculateSuggestions(
      ctx({
        entries: [entry({ amount: 5000, entry_date: '2026-09-05' })],
        historicalEntries: [entry({ amount: 10, entry_date: '2026-08-05' })],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('não alerta sem histórico nenhum', () => {
    const s = calculateSuggestions(ctx({ entries: [entry({ amount: 5000, entry_date: '2026-09-05' })] }))
    expect(s).toHaveLength(0)
  })
})

describe('calculateSuggestions — essencialidade', () => {
  it('categoria essencial nunca alerta, por mais que estoure', () => {
    const s = calculateSuggestions(
      ctx({
        categories: [category({ isEssential: true })],
        entries: [entry({ amount: 99_999, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 100 })],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('categoria de receita nunca alerta — a feature é sobre gasto', () => {
    const s = calculateSuggestions(
      ctx({
        categories: [category({ id: 'salario', direction: 'in', isEssential: false })],
        entries: [
          entry({ amount: 9000, entry_date: '2026-09-05', category_id: 'salario', direction: 'in' }),
        ],
        projections: [projection({ category_id: 'salario', projected_amount: 100 })],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('categoria desconhecida na árvore não vira alerta', () => {
    const s = calculateSuggestions(
      ctx({
        categories: [],
        entries: [entry({ amount: 900, entry_date: '2026-09-05' })],
        projections: [projection({ projected_amount: 100 })],
      })
    )
    expect(s).toHaveLength(0)
  })
})

describe('calculateSuggestions — subcategorias', () => {
  const arvore = [
    category({ id: 'lazer', name: 'Lazer', isEssential: false }),
    category({ id: 'cinema', name: 'Cinema', parentId: 'lazer', isEssential: false }),
  ]

  it('projeção em subcategoria é avaliada naquele nível', () => {
    const s = calculateSuggestions(
      ctx({
        categories: arvore,
        entries: [
          entry({ amount: 300, entry_date: '2026-09-05', subcategory_id: 'cinema' }),
          entry({ amount: 100, entry_date: '2026-09-06' }),
        ],
        projections: [projection({ subcategory_id: 'cinema', projected_amount: 100 })],
      })
    )
    expect(s).toHaveLength(1)
    expect(s[0].subcategoryId).toBe('cinema')
    // Só o que foi lançado NA subcategoria entra na conta.
    expect(s[0].realizedAmount).toBe(300)
  })

  it('projeção na categoria-mãe considera tudo da subárvore', () => {
    const s = calculateSuggestions(
      ctx({
        categories: arvore,
        entries: [
          entry({ amount: 300, entry_date: '2026-09-05', subcategory_id: 'cinema' }),
          entry({ amount: 400, entry_date: '2026-09-06' }),
        ],
        projections: [projection({ projected_amount: 500 })],
      })
    )
    expect(s).toHaveLength(1)
    expect(s[0].subcategoryId).toBeNull()
    expect(s[0].realizedAmount).toBe(700)
  })

  it('a subcategoria essencial não salva a mãe não essencial, e vice-versa', () => {
    const s = calculateSuggestions(
      ctx({
        categories: [
          category({ id: 'lazer', isEssential: true }),
          category({ id: 'cinema', parentId: 'lazer', isEssential: false }),
        ],
        entries: [entry({ amount: 300, entry_date: '2026-09-05', subcategory_id: 'cinema' })],
        projections: [
          projection({ id: 'p1', projected_amount: 10 }),
          projection({ id: 'p2', subcategory_id: 'cinema', projected_amount: 100 }),
        ],
      })
    )
    expect(s).toHaveLength(1)
    expect(s[0].subcategoryId).toBe('cinema')
  })
})

describe('calculateSuggestions — descarte', () => {
  const base = {
    entries: [entry({ amount: 800, entry_date: '2026-09-05' })],
    projections: [projection({ projected_amount: 500 })],
  }

  it('some quando descartado no mês corrente', () => {
    const s = calculateSuggestions(
      ctx({
        ...base,
        dismissals: [
          {
            id: 'd1',
            account_id: 'a1',
            category_id: 'lazer',
            subcategory_id: null,
            period_month: '2026-09-01',
            dismissed_at: '',
          },
        ],
      })
    )
    expect(s).toHaveLength(0)
  })

  it('descarte do mês anterior não silencia o mês corrente', () => {
    const s = calculateSuggestions(
      ctx({
        ...base,
        dismissals: [
          {
            id: 'd1',
            account_id: 'a1',
            category_id: 'lazer',
            subcategory_id: null,
            period_month: '2026-08-01',
            dismissed_at: '',
          },
        ],
      })
    )
    expect(s).toHaveLength(1)
  })
})

describe('calculateSuggestions — ordenação', () => {
  it('põe o maior excesso em reais primeiro', () => {
    const s = calculateSuggestions(
      ctx({
        categories: [
          category({ id: 'lazer', name: 'Lazer' }),
          category({ id: 'delivery', name: 'Delivery' }),
        ],
        entries: [
          entry({ amount: 600, entry_date: '2026-09-05', category_id: 'lazer' }),
          entry({ amount: 1500, entry_date: '2026-09-05', category_id: 'delivery' }),
        ],
        projections: [
          projection({ id: 'p1', category_id: 'lazer', projected_amount: 500 }),
          projection({ id: 'p2', category_id: 'delivery', projected_amount: 500 }),
        ],
      })
    )
    expect(s.map((x) => x.categoryName)).toEqual(['Delivery', 'Lazer'])
  })
})
