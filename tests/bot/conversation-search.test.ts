import { describe, it, expect } from 'vitest'
import { matchesConversationQuery, nameSearchText, phoneSearchDigits } from '@/lib/bot/conversation-search'

// A Meta às vezes entrega o celular sem o nono dígito: a conversa fica salva
// como 557192618890 e a pessoa busca 71 99261-8890. A busca usa os 8 dígitos
// finais, que são iguais nas duas formas.

const conversa = (phone: string, name: string | null = null, wa: string | null = null) => ({
  patient_phone: phone,
  patient_name: name,
  patient_whatsapp_name: wa,
})

describe('phoneSearchDigits', () => {
  it('usa os 8 dígitos finais quando há mais de 8', () => {
    expect(phoneSearchDigits('71 992618890')).toBe('92618890')
    expect(phoneSearchDigits('(71) 99261-8890')).toBe('92618890')
    expect(phoneSearchDigits('+55 71 9261-8890')).toBe('92618890')
  })

  it('mantém trechos curtos como digitados', () => {
    expect(phoneSearchDigits('92618890')).toBe('92618890')
    expect(phoneSearchDigits('8890')).toBe('8890')
  })

  it('menos de 4 dígitos não busca por telefone', () => {
    expect(phoneSearchDigits('71')).toBeNull()
    expect(phoneSearchDigits('Fabiane')).toBeNull()
  })
})

describe('nameSearchText', () => {
  it('só busca por nome quando há letra', () => {
    expect(nameSearchText('  Fabiane ')).toBe('fabiane')
    expect(nameSearchText('92618890')).toBeNull()
  })
})

describe('matchesConversationQuery', () => {
  it('acha número salvo sem o 9 buscando com o 9', () => {
    expect(matchesConversationQuery(conversa('557192618890'), '71 992618890')).toBe(true)
    expect(matchesConversationQuery(conversa('557192618890'), '92618890')).toBe(true)
  })

  it('acha número salvo com o 9 buscando sem o 9', () => {
    expect(matchesConversationQuery(conversa('5571992618890'), '7192618890')).toBe(true)
  })

  it('não confunde números diferentes', () => {
    expect(matchesConversationQuery(conversa('557192618891'), '71 992618890')).toBe(false)
  })

  it('busca pelo nome do paciente e pelo nome do WhatsApp', () => {
    expect(matchesConversationQuery(conversa('5511900000001', 'Fabiane Ferreira Pires'), 'ferreira')).toBe(true)
    expect(matchesConversationQuery(conversa('5511900000001', 'Paciente', 'Fabi'), 'fabi')).toBe(true)
    expect(matchesConversationQuery(conversa('5511900000001', 'Paciente'), 'fabi')).toBe(false)
  })
})
