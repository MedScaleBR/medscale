import { describe, it, expect, vi } from 'vitest'

// agent.ts arrasta supabase/whatsapp/anthropic no import — mockados para o
// teste da função pura parseAmount não tocar nada externo.
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }))
vi.mock('@/lib/whatsapp/send', () => ({ sendWhatsAppMessage: vi.fn() }))

import { parseAmount } from '@/lib/finance/agent'

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
