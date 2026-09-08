import { describe, it, expect } from 'vitest'

// parseAmount vive em respond.ts, junto das outras helpers puras de resposta —
// importá-la não arrasta supabase nem o cliente do WhatsApp.
import { parseAmount } from '@/lib/finance/respond'

describe('parseAmount', () => {
  it.each([
    ['32', 32],
    ['1200', 1200],
    ['1.200', 1200],
    ['1200,50', 1200.5],
    ['1.200,50', 1200.5],
    ['R$ 1.200,50', 1200.5],
    ['3.450,90', 3450.9],
    ['R$ 1.500', 1500],
    ['2.600', 2600],
    ['10.000', 10000],
    ['35,90', 35.9],
    ['1200 reais', 1200],
  ])('"%s" → %s', (text, expected) => {
    expect(parseAmount(text)).toBe(expected)
  })

  it.each(['abc', '', '0', '-5'])('"%s" → null', (text) => {
    expect(parseAmount(text)).toBeNull()
  })
})
