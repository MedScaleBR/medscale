import { describe, it, expect } from 'vitest'
import { parseEntryType } from '@/lib/finance/respond'

describe('parseEntryType', () => {
  it.each(['pf', 'PF', 'pessoal', 'é pessoal', 'meu', 'pessoa física'])('"%s" → pf', (t) => {
    expect(parseEntryType(t)).toBe('pf')
  })
  it.each(['pj', 'PJ', 'da clínica', 'clinica', 'empresa', 'cnpj', 'do consultório'])('"%s" → pj', (t) => {
    expect(parseEntryType(t)).toBe('pj')
  })
  it.each(['sim', 'talvez', 'não sei', '35', 'aluguel'])('"%s" → null', (t) => {
    expect(parseEntryType(t)).toBeNull()
  })
  it('"minha clínica" → pj (pj ganha de pf)', () => {
    expect(parseEntryType('minha clínica')).toBe('pj')
  })
})
