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

  // Negação sem vírgula é o oposto do que a alternância casaria: "não é da
  // clínica" tem "clinica" no texto e cairia em pj — o balde errado. Sem
  // entender a negação, o certo é não responder e o agente perguntar de novo.
  describe('negação', () => {
    it.each(['não é da clínica', 'nao e da clinica', 'não é pessoal', 'não sei'])(
      '"%s" → null',
      (t) => {
        expect(parseEntryType(t)).toBeNull()
      }
    )
    it('"não, é da clínica" → pj (vírgula = correção, não negação)', () => {
      expect(parseEntryType('não, é da clínica')).toBe('pj')
    })
    it('"não, pessoal" → pf', () => {
      expect(parseEntryType('não, pessoal')).toBe('pf')
    })
  })

  // "consulta particular" é receita da clínica neste domínio — mapear
  // "particular" para pf seria o balde errado. Fora da lista: o agente
  // pergunta de novo.
  it('"particular" → null (ambíguo no domínio médico)', () => {
    expect(parseEntryType('particular')).toBeNull()
  })
})
