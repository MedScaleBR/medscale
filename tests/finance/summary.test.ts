import { describe, it, expect } from 'vitest'
import {
  averageSaldo,
  buildMonthlySeries,
  categoryBreakdown,
  forecastSummary,
  formatPct,
  pctDelta,
  shiftMonth,
  summarizeMonth,
} from '@/lib/finance/summary'
import type { FinanceEntry } from '@/lib/finance/types'
import type { CategoryNode } from '@/lib/finance/categories'

function entry(partial: Partial<FinanceEntry> & { amount: number; entry_date: string }): FinanceEntry {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'a1',
    workspace_id: null,
    user_id: 'u1',
    type: 'pf',
    direction: 'out',
    description: null,
    category: null,
    category_id: null,
    subcategory_id: null,
    raw_message: '',
    revenue_entry_id: null,
    created_at: '',
    ...partial,
  } as FinanceEntry
}

function root(id: string, name: string): CategoryNode {
  return { id, name, direction: 'out', sortOrder: 0, isArchived: false, isEssential: true, children: [] }
}

describe('shiftMonth', () => {
  it('atravessa a virada do ano nos dois sentidos', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-09', -12)).toBe('2025-09')
  })
})

describe('summarizeMonth', () => {
  const entries = [
    entry({ amount: 100, entry_date: '2026-09-03', direction: 'in' }),
    entry({ amount: 40, entry_date: '2026-09-10', direction: 'out' }),
    entry({ amount: 999, entry_date: '2026-08-31', direction: 'out' }),
  ]

  it('soma só o mês pedido e devolve o saldo', () => {
    expect(summarizeMonth(entries, '2026-09')).toEqual({ receitas: 100, despesas: 40, saldo: 60 })
  })

  it('mês sem lançamento vem zerado em vez de indefinido', () => {
    expect(summarizeMonth(entries, '2026-07')).toEqual({ receitas: 0, despesas: 0, saldo: 0 })
  })
})

describe('buildMonthlySeries', () => {
  it('devolve exatamente 12 pontos terminando no mês pedido', () => {
    const series = buildMonthlySeries([], '2026-09')
    expect(series).toHaveLength(12)
    expect(series[0].month).toBe('2025-10')
    expect(series[11].month).toBe('2026-09')
  })

  it('preenche meses vazios com zero para o gráfico não perder colunas', () => {
    const series = buildMonthlySeries([entry({ amount: 50, entry_date: '2026-09-01', direction: 'in' })], '2026-09')
    expect(series[11].receitas).toBe(50)
    expect(series[10]).toMatchObject({ receitas: 0, despesas: 0, saldo: 0 })
  })
})

describe('pctDelta', () => {
  it('calcula a variação sobre o mês anterior', () => {
    expect(pctDelta(13530, 8760)).toBeCloseTo(54.45, 1)
    expect(pctDelta(80, 100)).toBe(-20)
  })

  it('devolve null quando não há base de comparação', () => {
    expect(pctDelta(500, 0)).toBeNull()
  })

  it('usa o módulo da base, então sair do negativo é alta', () => {
    expect(pctDelta(50, -100)).toBe(150)
  })
})

describe('formatPct', () => {
  it('prefixa sinal e usa o menos tipográfico na queda', () => {
    expect(formatPct(54.45)).toBe('+54,5%')
    expect(formatPct(-6.1)).toBe('−6,1%')
    expect(formatPct(0)).toBe('0%')
  })
})

describe('averageSaldo', () => {
  it('tira a média dos saldos da janela', () => {
    const series = buildMonthlySeries(
      [
        entry({ amount: 120, entry_date: '2026-09-01', direction: 'in' }),
        entry({ amount: 60, entry_date: '2026-08-01', direction: 'in' }),
      ],
      '2026-09'
    )
    expect(averageSaldo(series)).toBe(15) // 180 / 12
  })

  it('não divide por zero com série vazia', () => {
    expect(averageSaldo([])).toBe(0)
  })
})

describe('categoryBreakdown', () => {
  const roots = [root('c-mor', 'Moradia'), root('c-ali', 'Alimentação')]

  it('agrupa por raiz, ordena pelo maior e calcula ratio e share', () => {
    const slices = categoryBreakdown(
      [
        entry({ amount: 3000, entry_date: '2026-09-01', category_id: 'c-mor' }),
        entry({ amount: 200, entry_date: '2026-09-02', category_id: 'c-mor' }),
        entry({ amount: 1600, entry_date: '2026-09-03', category_id: 'c-ali' }),
      ],
      roots
    )
    expect(slices.map((s) => s.name)).toEqual(['Moradia', 'Alimentação'])
    expect(slices[0].total).toBe(3200)
    expect(slices[0].ratio).toBe(1) // maior item preenche a barra
    expect(slices[1].ratio).toBe(0.5)
    expect(slices[1].share).toBeCloseTo(1600 / 4800, 5)
  })

  it('marca como sem categoria só o que não tem raiz nem snapshot', () => {
    const slices = categoryBreakdown(
      [
        entry({ amount: 430, entry_date: '2026-09-01' }),
        entry({ amount: 100, entry_date: '2026-09-02', category: 'Consultas particulares' }),
      ],
      roots
    )
    const semCat = slices.find((s) => s.name === 'Sem categoria')!
    expect(semCat.uncategorized).toBe(true)
    expect(slices.find((s) => s.name === 'Consultas particulares')!.uncategorized).toBe(false)
  })

  it('lista vazia não gera divisão por zero', () => {
    expect(categoryBreakdown([], roots)).toEqual([])
  })
})

describe('forecastSummary', () => {
  const receitas = [
    entry({ amount: 21800, entry_date: '2026-09-05', direction: 'in', revenue_entry_id: 'r1' }),
    entry({ amount: 10650, entry_date: '2026-09-06', direction: 'in' }),
  ]

  it('separa espelho do ciclo de lançamento manual', () => {
    const f = forecastSummary(receitas, [], '2026-09')
    expect(f.confirmado).toBe(21800)
    expect(f.manual).toBe(10650)
  })

  it('soma os pendentes do mês e conta as consultas', () => {
    const f = forecastSummary(receitas, [
      { id: 'p1', amount: 4000, entry_date: '2026-09-20' },
      { id: 'p2', amount: 2150, entry_date: '2026-09-25' },
      { id: 'p3', amount: 900, entry_date: '2026-10-02' }, // fora do mês
    ], '2026-09')
    expect(f.aConfirmar).toBe(6150)
    expect(f.pendingCount).toBe(2)
    expect(f.ratio).toBeCloseTo(21800 / 27950, 5)
  })

  it('ratio é 0 quando não há nada do ciclo, sem NaN', () => {
    const f = forecastSummary([entry({ amount: 500, entry_date: '2026-09-01', direction: 'in' })], [], '2026-09')
    expect(f.ratio).toBe(0)
    expect(f.confirmado).toBe(0)
  })
})
