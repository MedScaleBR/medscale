import { describe, it, expect } from 'vitest'
import { clickDay, dayState, draftToRange, draftTooLong, monthGrid, rangeLabel } from '@/lib/admin/calendar-grid'

describe('monthGrid', () => {
  it('novembro de 2026 começa no domingo e termina no dia 30', () => {
    const g = monthGrid(2026, 10)
    expect(g[0]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
    const last = g.at(-1)!
    expect(last).toHaveLength(7)
    expect(last[1]).toBe('2026-11-30')
    expect(last.slice(2)).toEqual([null, null, null, null, null])
  })

  it('outubro de 2026 começa na quinta, com nulls antes', () => {
    expect(monthGrid(2026, 9)[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03'])
  })
})

describe('clickDay', () => {
  it('dois cliques formam o intervalo em ordem; o terceiro recomeça', () => {
    let d = clickDay({ start: null, end: null }, '2026-11-11')
    expect(d).toEqual({ start: '2026-11-11', end: null })
    d = clickDay(d, '2026-11-03')
    expect(d).toEqual({ start: '2026-11-03', end: '2026-11-11' })
    d = clickDay(d, '2026-11-05')
    expect(d).toEqual({ start: '2026-11-05', end: null })
  })
})

describe('draftToRange', () => {
  it('início sozinho é um dia', () => {
    expect(draftToRange({ start: '2026-11-11', end: null })).toEqual({ from: '2026-11-11', to: '2026-11-11' })
  })
  it('vazio é null', () => {
    expect(draftToRange({ start: null, end: null })).toBeNull()
  })
})

describe('dayState', () => {
  const draft = { start: '2026-11-03', end: '2026-11-11' }
  const today = '2026-11-12'
  it('estados do intervalo, hoje e futuro', () => {
    expect(dayState('2026-11-03', draft, today)).toBe('start')
    expect(dayState('2026-11-11', draft, today)).toBe('end')
    expect(dayState('2026-11-05', draft, today)).toBe('in')
    expect(dayState('2026-11-12', draft, today)).toBe('today')
    expect(dayState('2026-11-13', draft, today)).toBe('future')
    expect(dayState('2026-11-01', draft, today)).toBe('normal')
    expect(dayState('2026-11-11', { start: '2026-11-11', end: null }, today)).toBe('single')
  })
})

describe('draftTooLong', () => {
  it('mais de 366 dias não pode aplicar', () => {
    expect(draftTooLong({ start: '2025-01-01', end: '2026-11-12' })).toBe(true)
    expect(draftTooLong({ start: '2026-01-01', end: '2026-11-12' })).toBe(false)
  })
})

describe('rangeLabel', () => {
  it('resumo do rodapé', () => {
    expect(rangeLabel({ from: '2026-11-03', to: '2026-11-11' })).toBe('3 nov – 11 nov · 9 dias')
    expect(rangeLabel({ from: '2026-11-11', to: '2026-11-11' })).toBe('11 nov · 1 dia')
  })
})
