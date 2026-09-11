import { describe, it, expect } from 'vitest'
import { calculateGoalStatus, projectedMonthlyExpense } from '@/lib/finance/goals'
import type {
  FinanceGoal,
  FinanceInvestment,
  FinanceProjection,
  ReserveWithBalance,
} from '@/lib/finance/types'

const HOJE = new Date('2026-09-11T12:00:00-03:00')

function goal(partial: Partial<FinanceGoal> = {}): FinanceGoal {
  return {
    id: 'g1',
    account_id: 'a1',
    kind: 'pf',
    name: 'Viagem',
    mode: 'manual',
    target_amount: 10_000,
    target_date: null,
    months_of_expenses: 1,
    linked_reserve_id: null,
    status: 'active',
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

function reserve(partial: Partial<ReserveWithBalance> = {}): ReserveWithBalance {
  return {
    id: 'r1',
    account_id: 'a1',
    kind: 'pf',
    name: 'Emergência',
    archived_at: null,
    created_at: '',
    balance: 0,
    movements: [],
    ...partial,
  }
}

function investment(partial: Partial<FinanceInvestment> = {}): FinanceInvestment {
  return {
    id: 'i1',
    account_id: 'a1',
    kind: 'pf',
    name: 'CDB',
    type: 'renda_fixa',
    invested_amount: 1000,
    current_value: null,
    rate_type: null,
    rate_value: null,
    start_date: '2026-01-01',
    maturity_date: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

function projection(partial: Partial<FinanceProjection> = {}): FinanceProjection {
  return {
    id: 'p1',
    account_id: 'a1',
    category_id: 'c1',
    subcategory_id: null,
    period_month: '2026-09-01',
    projected_amount: 800,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

const VAZIO = { reserves: [], investments: [], projections: [], today: HOJE }

describe('projectedMonthlyExpense', () => {
  it('soma as projeções de categoria', () => {
    const total = projectedMonthlyExpense([
      projection({ id: 'p1', category_id: 'c1', projected_amount: 800 }),
      projection({ id: 'p2', category_id: 'c2', projected_amount: 500 }),
    ])
    expect(total).toBe(1300)
  })

  it('ignora as subcategorias quando a categoria tem valor próprio — senão contaria duas vezes', () => {
    const total = projectedMonthlyExpense([
      projection({ id: 'p1', category_id: 'c1', subcategory_id: null, projected_amount: 800 }),
      projection({ id: 'p2', category_id: 'c1', subcategory_id: 's1', projected_amount: 300 }),
    ])
    expect(total).toBe(800)
  })

  it('soma as subcategorias quando a categoria não tem valor próprio', () => {
    const total = projectedMonthlyExpense([
      projection({ id: 'p1', category_id: 'c1', subcategory_id: 's1', projected_amount: 300 }),
      projection({ id: 'p2', category_id: 'c1', subcategory_id: 's2', projected_amount: 200 }),
    ])
    expect(total).toBe(500)
  })
})

describe('calculateGoalStatus — patrimônio acumulado', () => {
  it('soma reservas ativas e investimentos do mesmo kind', () => {
    const s = calculateGoalStatus(goal(), {
      ...VAZIO,
      reserves: [reserve({ balance: 3000 }), reserve({ id: 'r2', balance: 1500 })],
      investments: [investment({ current_value: 2000 })],
    })
    expect(s.currentSaved).toBe(6500)
  })

  it('ignora reserva arquivada e patrimônio de outro kind', () => {
    const s = calculateGoalStatus(goal({ kind: 'pf' }), {
      ...VAZIO,
      reserves: [
        reserve({ balance: 3000 }),
        reserve({ id: 'r2', balance: 999, archived_at: '2026-01-01T00:00:00Z' }),
        reserve({ id: 'r3', kind: 'pj', balance: 777 }),
      ],
      investments: [investment({ kind: 'pj', current_value: 5000 })],
    })
    expect(s.currentSaved).toBe(3000)
  })

  it('meta vinculada a uma reserva olha só aquela caixinha', () => {
    const s = calculateGoalStatus(goal({ linked_reserve_id: 'r2' }), {
      ...VAZIO,
      reserves: [reserve({ balance: 3000 }), reserve({ id: 'r2', balance: 1500 })],
      investments: [investment({ current_value: 9999 })],
    })
    expect(s.currentSaved).toBe(1500)
  })

  it('investimento sem valor informado e sem taxa entra pelo valor investido', () => {
    const s = calculateGoalStatus(goal(), { ...VAZIO, investments: [investment()] })
    expect(s.currentSaved).toBe(1000)
  })
})

describe('calculateGoalStatus — modo manual', () => {
  it('usa o target_amount e NÃO recalcula a partir das projeções', () => {
    const s = calculateGoalStatus(goal({ mode: 'manual', target_amount: 10_000 }), {
      ...VAZIO,
      projections: [projection({ projected_amount: 99_999 })],
      reserves: [reserve({ balance: 2500 })],
    })
    expect(s.requiredTotal).toBe(10_000)
    expect(s.remaining).toBe(7500)
    expect(s.progressPct).toBeCloseTo(25, 5)
  })

  it('meta batida zera o que falta e trava o progresso em 100%', () => {
    const s = calculateGoalStatus(goal({ target_amount: 1000 }), {
      ...VAZIO,
      reserves: [reserve({ balance: 4000 })],
    })
    expect(s.remaining).toBe(0)
    expect(s.progressPct).toBe(100)
  })
})

describe('calculateGoalStatus — modo automático', () => {
  it('deriva o alvo das projeções do período', () => {
    const s = calculateGoalStatus(goal({ mode: 'auto', target_amount: null }), {
      ...VAZIO,
      projections: [
        projection({ id: 'p1', category_id: 'c1', projected_amount: 800 }),
        projection({ id: 'p2', category_id: 'c2', projected_amount: 1200 }),
      ],
    })
    expect(s.requiredTotal).toBe(2000)
  })

  it('multiplica pelos meses de despesa — reserva de emergência de 6 meses', () => {
    const s = calculateGoalStatus(
      goal({ mode: 'auto', target_amount: null, months_of_expenses: 6 }),
      { ...VAZIO, projections: [projection({ projected_amount: 2000 })] }
    )
    expect(s.requiredTotal).toBe(12_000)
  })

  it('acompanha a projeção: mudou a projeção, muda o alvo (nada congelado)', () => {
    const ctx = (valor: number) => ({
      ...VAZIO,
      projections: [projection({ projected_amount: valor })],
    })
    const antes = calculateGoalStatus(goal({ mode: 'auto', target_amount: null }), ctx(1000))
    const depois = calculateGoalStatus(goal({ mode: 'auto', target_amount: null }), ctx(3000))
    expect(antes.requiredTotal).toBe(1000)
    expect(depois.requiredTotal).toBe(3000)
  })

  it('sem projeção nenhuma o alvo é zero, não um chute', () => {
    const s = calculateGoalStatus(goal({ mode: 'auto', target_amount: null }), VAZIO)
    expect(s.requiredTotal).toBe(0)
    expect(s.remaining).toBe(0)
  })
})

describe('calculateGoalStatus — prazo', () => {
  it('sem target_date não divide por mês', () => {
    const s = calculateGoalStatus(goal({ target_date: null }), VAZIO)
    expect(s.monthsRemaining).toBeNull()
    expect(s.monthlyRequired).toBeNull()
  })

  it('divide o que falta pelos meses cheios até o prazo', () => {
    // 2026-09-11 -> 2026-12-01 = 3 meses
    const s = calculateGoalStatus(goal({ target_amount: 9000, target_date: '2026-12-01' }), VAZIO)
    expect(s.monthsRemaining).toBe(3)
    expect(s.monthlyRequired).toBe(3000)
  })

  it('prazo dentro do mês corrente conta como 1, não como 0 (divisão por zero)', () => {
    const s = calculateGoalStatus(goal({ target_amount: 500, target_date: '2026-09-30' }), VAZIO)
    expect(s.monthsRemaining).toBe(1)
    expect(s.monthlyRequired).toBe(500)
  })

  it('prazo vencido cobra o restante inteiro de uma vez', () => {
    const s = calculateGoalStatus(goal({ target_amount: 500, target_date: '2026-01-01' }), VAZIO)
    expect(s.monthsRemaining).toBe(0)
    expect(s.monthlyRequired).toBe(500)
  })

  it('meta já batida não pede mensalidade nenhuma', () => {
    const s = calculateGoalStatus(goal({ target_amount: 500, target_date: '2026-12-01' }), {
      ...VAZIO,
      reserves: [reserve({ balance: 900 })],
    })
    expect(s.monthlyRequired).toBe(0)
  })
})
