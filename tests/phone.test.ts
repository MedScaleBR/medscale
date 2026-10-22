import { describe, expect, it } from 'vitest'
import { brazilianPhoneKey, formatBrazilianPhone, normalizeBrazilianPhone } from '../lib/phone'

describe('Brazilian patient phones', () => {
  it.each(['11987654321', '(11) 98765-4321', '5511987654321', '+55 (11) 98765-4321'])('displays %s without DDI', (phone) => {
    expect(formatBrazilianPhone(phone)).toBe('(11) 98765-4321')
    expect(normalizeBrazilianPhone(phone)).toBe('5511987654321')
  })
  it('preserves DDD 55 and landlines without inventing digits', () => {
    expect(formatBrazilianPhone('55987654321')).toBe('(55) 98765-4321')
    expect(normalizeBrazilianPhone('55987654321')).toBe('5555987654321')
    expect(formatBrazilianPhone('551132145678')).toBe('(11) 3214-5678')
    expect(normalizeBrazilianPhone('(11) 3214-5678')).toBe('551132145678')
  })
  it('formats partial input and rejects incomplete numbers on save', () => {
    expect(formatBrazilianPhone('')).toBe('')
    expect(formatBrazilianPhone('119876')).toBe('(11) 9876')
    expect(normalizeBrazilianPhone('119876')).toBeNull()
    expect(normalizeBrazilianPhone('')).toBeNull()
    expect(normalizeBrazilianPhone('4411987654321')).toBeNull()
  })
})

describe('brazilianPhoneKey', () => {
  it('ignora o nono dígito e a formatação', () => {
    for (const p of ['5571999990000', '557199990000', '(71) 99999-0000', '+55 71 9999-0000', '71999990000'])
      expect(brazilianPhoneKey(p)).toBe('557199990000')
  })
  it('separa DDDs diferentes', () => expect(brazilianPhoneKey('5511999990000')).not.toBe(brazilianPhoneKey('5571999990000')))
})
