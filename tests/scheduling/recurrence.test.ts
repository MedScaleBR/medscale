import { describe, it, expect } from 'vitest'
import {
  addDaysToDate,
  formatShortDate,
  nextRuleDates,
  recurrenceProblem,
  ruleAppliesOn,
  weekdayOfDate,
} from '@/lib/scheduling/recurrence'

// 11/11/2025 é terça (2).
const TUE = '2025-11-11'
const biweekly = { day_of_week: 2, interval_weeks: 2, anchor_date: TUE }

describe('ruleAppliesOn', () => {
  it('quinzenal: vale na âncora, em +14, +28 e -14; não vale em +7 nem +21', () => {
    expect(weekdayOfDate(TUE)).toBe(2)
    expect(ruleAppliesOn(biweekly, TUE)).toBe(true)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, 14))).toBe(true)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, 28))).toBe(true)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, -14))).toBe(true)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, 7))).toBe(false)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, 21))).toBe(false)
    expect(ruleAppliesOn(biweekly, addDaysToDate(TUE, -7))).toBe(false)
  })

  it('a cada 3 semanas: vale em +21 e -21; não vale em +14', () => {
    const rule = { day_of_week: 2, interval_weeks: 3, anchor_date: TUE }
    expect(ruleAppliesOn(rule, addDaysToDate(TUE, 21))).toBe(true)
    expect(ruleAppliesOn(rule, addDaysToDate(TUE, -21))).toBe(true)
    expect(ruleAppliesOn(rule, addDaysToDate(TUE, 14))).toBe(false)
  })

  it('toda semana: vale em toda terça, como hoje, e nunca em outro dia', () => {
    const weekly = { day_of_week: 2, interval_weeks: 1, anchor_date: null }
    for (let w = -5; w <= 5; w++) expect(ruleAppliesOn(weekly, addDaysToDate(TUE, w * 7))).toBe(true)
    expect(ruleAppliesOn(weekly, addDaysToDate(TUE, 1))).toBe(false)
    // Colunas ausentes (migration pendente) = toda semana.
    expect(ruleAppliesOn({ day_of_week: 2 }, TUE)).toBe(true)
  })

  it('vira o mês e o ano: âncora 30/12, próxima 13/01', () => {
    const rule = { day_of_week: weekdayOfDate('2025-12-30'), interval_weeks: 2, anchor_date: '2025-12-30' }
    expect(rule.day_of_week).toBe(2)
    expect(ruleAppliesOn(rule, '2026-01-13')).toBe(true)
    expect(ruleAppliesOn(rule, '2026-01-06')).toBe(false)
    expect(nextRuleDates([rule], [], '2025-12-31', 2, 60)).toEqual(['2026-01-13', '2026-01-27'])
  })

  it('regra repetida sem âncora nunca vale', () => {
    expect(ruleAppliesOn({ day_of_week: 2, interval_weeks: 2, anchor_date: null }, TUE)).toBe(false)
  })
})

describe('nextRuleDates', () => {
  it('lista as próximas datas, pula dia bloqueado inteiro e inclui extra', () => {
    const exceptions = [
      { date: addDaysToDate(TUE, 14), type: 'blocked', start_time: null },
      { date: addDaysToDate(TUE, 15), type: 'blocked', start_time: '08:00' }, // parcial: não tira
      { date: '2025-11-15', type: 'extra', start_time: '08:00' },
    ]
    expect(nextRuleDates([biweekly], exceptions, TUE, 3, 60)).toEqual(['2025-11-11', '2025-11-15', '2025-12-09'])
  })

  it('respeita maxDays', () => {
    expect(nextRuleDates([biweekly], [], '2025-11-12', 3, 13)).toEqual([])
    expect(nextRuleDates([biweekly], [], '2025-11-12', 3, 14)).toEqual(['2025-11-25'])
  })
})

describe('recurrenceProblem', () => {
  it('valida intervalo, âncora obrigatória e dia da semana', () => {
    expect(recurrenceProblem({ day_of_week: 2, interval_weeks: 1, anchor_date: null })).toBeNull()
    expect(recurrenceProblem({ day_of_week: 2, interval_weeks: undefined, anchor_date: undefined })).toBeNull()
    expect(recurrenceProblem({ day_of_week: 2, interval_weeks: 5, anchor_date: TUE })).toMatch(/1 a 4/)
    expect(recurrenceProblem({ day_of_week: 2, interval_weeks: 2, anchor_date: null })).toMatch(/Informe/)
    expect(recurrenceProblem({ day_of_week: 3, interval_weeks: 2, anchor_date: TUE })).toMatch(/mesmo dia da semana/)
    expect(recurrenceProblem({ day_of_week: 2, interval_weeks: 2, anchor_date: TUE })).toBeNull()
  })

  it('formatShortDate', () => {
    expect(formatShortDate(TUE)).toBe('ter 11/11')
  })
})
