import { describe, it, expect } from 'vitest'
import { endOfNextMonth, parseBookingOpenUntil } from '@/lib/scheduling/booking-window'

describe('agenda aberta até — validação', () => {
  it('vazio ou null = sem limite', () => {
    expect(parseBookingOpenUntil('')).toEqual({ ok: true, value: null })
    expect(parseBookingOpenUntil(null)).toEqual({ ok: true, value: null })
  })

  it('aceita data real e recusa inválida', () => {
    expect(parseBookingOpenUntil('2026-12-31')).toEqual({ ok: true, value: '2026-12-31' })
    expect(parseBookingOpenUntil('2026-02-30').ok).toBe(false)
    expect(parseBookingOpenUntil('31/12/2026').ok).toBe(false)
    expect(parseBookingOpenUntil(20261231).ok).toBe(false)
  })

  it('fim do mês que vem', () => {
    expect(endOfNextMonth('2026-11-09')).toBe('2026-12-31')
    expect(endOfNextMonth('2026-12-15')).toBe('2027-01-31')
    expect(endOfNextMonth('2027-01-31')).toBe('2027-02-28')
  })
})
