import { describe, it, expect } from 'vitest'
import {
  parseCostWindow,
  windowFromDays,
  previousWindow,
  windowDayCount,
  isSingleDay,
  costWindowQuery,
  presetRange,
} from '@/lib/admin/cost-range'

// Quinta, 12/11/2026, 12:00 em São Paulo.
const now = new Date('2026-11-12T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('parseCostWindow', () => {
  it('sem parâmetros, 30 dias', () => {
    const w = parseCostWindow({}, now)
    expect(w).toMatchObject({ kind: 'days', days: 30, until: null })
    expect(w.since).toBe(new Date(now.getTime() - 30 * DAY).toISOString())
  })

  it('aceita 7/30/90 e rejeita o resto', () => {
    expect(parseCostWindow({ days: '7' }, now)).toMatchObject({ kind: 'days', days: 7 })
    expect(parseCostWindow({ days: '8' }, now)).toMatchObject({ kind: 'days', days: 30 })
  })

  it('intervalo vira dias inteiros de São Paulo', () => {
    const w = parseCostWindow({ from: '2026-11-03', to: '2026-11-11' }, now)
    expect(w).toMatchObject({ kind: 'custom', from: '2026-11-03', to: '2026-11-11' })
    expect(w.since).toBe('2026-11-03T03:00:00.000Z')
    expect(w.until).toBe('2026-11-12T03:00:00.000Z')
    expect(windowDayCount(w)).toBe(9)
    expect(isSingleDay(w)).toBe(false)
  })

  it('um dia só', () => {
    const w = parseCostWindow({ from: '2026-11-11', to: '2026-11-11' }, now)
    expect(isSingleDay(w)).toBe(true)
    expect(windowDayCount(w)).toBe(1)
  })

  it('from/to vence days', () => {
    expect(parseCostWindow({ days: '7', from: '2026-11-03', to: '2026-11-04' }, now).kind).toBe('custom')
  })

  it('hoje é um "to" válido', () => {
    expect(parseCostWindow({ from: '2026-11-12', to: '2026-11-12' }, now).kind).toBe('custom')
  })

  it.each([
    ['invertido', { from: '2026-11-12', to: '2026-11-03' }],
    ['futuro', { from: '2026-11-13', to: '2026-11-13' }],
    ['lixo', { from: 'x', to: 'y' }],
    ['data inexistente', { from: '2026-02-30', to: '2026-03-01' }],
    ['só from', { from: '2026-11-03' }],
    ['mais de 366 dias', { from: '2025-01-01', to: '2026-11-12' }],
  ])('%s cai em 30 dias', (_, params) => {
    expect(parseCostWindow(params, now)).toMatchObject({ kind: 'days', days: 30 })
  })
})

describe('previousWindow', () => {
  it('intervalo: mesmo tamanho imediatamente antes', () => {
    const w = parseCostWindow({ from: '2026-11-03', to: '2026-11-11' }, now)
    expect(previousWindow(w)).toEqual({ since: '2026-10-25T03:00:00.000Z', until: '2026-11-03T03:00:00.000Z' })
  })

  it('dias: [now-2N, now-N)', () => {
    const w = windowFromDays(7, now)
    expect(previousWindow(w, now)).toEqual({
      since: new Date(now.getTime() - 14 * DAY).toISOString(),
      until: new Date(now.getTime() - 7 * DAY).toISOString(),
    })
  })
})

describe('presetRange', () => {
  it('atalhos do calendário em São Paulo', () => {
    expect(presetRange('hoje', now)).toEqual({ from: '2026-11-12', to: '2026-11-12' })
    expect(presetRange('ontem', now)).toEqual({ from: '2026-11-11', to: '2026-11-11' })
    expect(presetRange('esta_semana', now)).toEqual({ from: '2026-11-08', to: '2026-11-12' })
    expect(presetRange('este_mes', now)).toEqual({ from: '2026-11-01', to: '2026-11-12' })
    expect(presetRange('mes_passado', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('mês passado em janeiro volta para dezembro', () => {
    expect(presetRange('mes_passado', new Date('2026-01-10T15:00:00Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
  })
})

describe('costWindowQuery', () => {
  it('serializa de volta para a URL', () => {
    expect(costWindowQuery(windowFromDays(30, now))).toEqual({ days: '30' })
    expect(costWindowQuery(parseCostWindow({ from: '2026-11-03', to: '2026-11-11' }, now))).toEqual({
      from: '2026-11-03',
      to: '2026-11-11',
    })
  })
})
