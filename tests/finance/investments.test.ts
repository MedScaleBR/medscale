import { describe, it, expect } from 'vitest'
import {
  CDI_ANNUAL_PCT,
  IPCA_ANNUAL_PCT,
  calculateInvestmentProjection,
  investmentCurrentValue,
} from '@/lib/finance/investments'
import type { FinanceInvestment } from '@/lib/finance/types'

function investment(partial: Partial<FinanceInvestment> = {}): FinanceInvestment {
  return {
    id: 'i1',
    account_id: 'a1',
    kind: 'pf',
    name: 'CDB Banco X',
    type: 'renda_fixa',
    invested_amount: 1000,
    current_value: null,
    rate_type: null,
    rate_value: null,
    start_date: '2025-09-11',
    maturity_date: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

// Fixa o "hoje" de todos os testes: exatamente um ano depois do start_date
// padrão, para os números esperados serem a taxa anual crua.
const UM_ANO_DEPOIS = new Date('2026-09-11T12:00:00-03:00')

describe('calculateInvestmentProjection — dados insuficientes', () => {
  it('devolve null sem rate_type', () => {
    expect(calculateInvestmentProjection(investment({ rate_value: 12 }), UM_ANO_DEPOIS)).toBeNull()
  })

  it('devolve null sem rate_value', () => {
    expect(
      calculateInvestmentProjection(investment({ rate_type: 'fixed_annual' }), UM_ANO_DEPOIS)
    ).toBeNull()
  })

  it('devolve null com rate_value zero — taxa zerada não é taxa informada', () => {
    expect(
      calculateInvestmentProjection(
        investment({ rate_type: 'pct_cdi', rate_value: 0 }),
        UM_ANO_DEPOIS
      )
    ).toBeNull()
  })

  it('devolve null quando start_date é futura, em vez de render negativo', () => {
    const futuro = investment({
      rate_type: 'fixed_annual',
      rate_value: 12,
      start_date: '2027-01-01',
    })
    expect(calculateInvestmentProjection(futuro, UM_ANO_DEPOIS)).toBeNull()
  })

  it('nunca lança, mesmo com data inválida', () => {
    const quebrado = investment({ rate_type: 'fixed_annual', rate_value: 12, start_date: 'xx' })
    expect(() => calculateInvestmentProjection(quebrado, UM_ANO_DEPOIS)).not.toThrow()
    expect(calculateInvestmentProjection(quebrado, UM_ANO_DEPOIS)).toBeNull()
  })
})

describe('calculateInvestmentProjection — com taxa', () => {
  it('fixed_annual: 12% a.a. em um ano rende 12%', () => {
    const r = calculateInvestmentProjection(
      investment({ rate_type: 'fixed_annual', rate_value: 12 }),
      UM_ANO_DEPOIS
    )
    expect(r).not.toBeNull()
    expect(r!.annualRatePct).toBeCloseTo(12, 5)
    expect(r!.estimatedCurrentValue).toBeCloseTo(1120, 2)
    expect(r!.projectedAtMaturity).toBeNull()
  })

  it('pct_cdi: 110% do CDI usa a constante versionada', () => {
    const r = calculateInvestmentProjection(
      investment({ rate_type: 'pct_cdi', rate_value: 110 }),
      UM_ANO_DEPOIS
    )!
    expect(r.annualRatePct).toBeCloseTo(CDI_ANNUAL_PCT * 1.1, 5)
    expect(r.estimatedCurrentValue).toBeCloseTo(1000 * (1 + (CDI_ANNUAL_PCT * 1.1) / 100), 2)
  })

  it('ipca_plus: IPCA + 6 soma, não multiplica', () => {
    const r = calculateInvestmentProjection(
      investment({ rate_type: 'ipca_plus', rate_value: 6 }),
      UM_ANO_DEPOIS
    )!
    expect(r.annualRatePct).toBeCloseTo(IPCA_ANNUAL_PCT + 6, 5)
  })

  it('juros compostos: dois anos a 10% dão 21%, não 20%', () => {
    const doisAnos = new Date('2027-09-11T12:00:00-03:00')
    const r = calculateInvestmentProjection(
      investment({ rate_type: 'fixed_annual', rate_value: 10 }),
      doisAnos
    )!
    expect(r.estimatedCurrentValue).toBeCloseTo(1210, 0)
  })

  it('projeta o valor no vencimento quando há maturity_date', () => {
    const r = calculateInvestmentProjection(
      investment({
        rate_type: 'fixed_annual',
        rate_value: 10,
        maturity_date: '2028-09-11',
      }),
      UM_ANO_DEPOIS
    )!
    // 3 anos de start_date até o vencimento: 1000 * 1.1^3
    expect(r.projectedAtMaturity).toBeCloseTo(1331, 0)
  })

  it('vencimento já passado não projeta para trás do valor de hoje', () => {
    const r = calculateInvestmentProjection(
      investment({
        rate_type: 'fixed_annual',
        rate_value: 10,
        start_date: '2024-09-11',
        maturity_date: '2025-09-11',
      }),
      UM_ANO_DEPOIS
    )!
    // Rendimento parou no vencimento: o valor de hoje é o do vencimento.
    expect(r.projectedAtMaturity).toBeCloseTo(1100, 0)
    expect(r.estimatedCurrentValue).toBeCloseTo(1100, 0)
  })
})

describe('investmentCurrentValue', () => {
  it('prefere o valor informado pelo owner ao estimado', () => {
    const v = investmentCurrentValue(
      investment({ current_value: 2000, rate_type: 'fixed_annual', rate_value: 12 }),
      UM_ANO_DEPOIS
    )
    expect(v).toBe(2000)
  })

  it('cai no estimado quando não há valor informado', () => {
    const v = investmentCurrentValue(
      investment({ rate_type: 'fixed_annual', rate_value: 12 }),
      UM_ANO_DEPOIS
    )
    expect(v).toBeCloseTo(1120, 2)
  })

  it('cai no valor investido quando não há nem valor informado nem taxa', () => {
    expect(investmentCurrentValue(investment(), UM_ANO_DEPOIS)).toBe(1000)
  })
})
