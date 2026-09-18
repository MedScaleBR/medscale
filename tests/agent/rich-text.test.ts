import { describe, it, expect } from 'vitest'
import { parseRichText, toWhatsAppMarkup } from '@/lib/bot/rich-text'

describe('parseRichText', () => {
  it('sem marcação devolve um trecho só', () => {
    expect(parseRichText('bom dia')).toEqual([{ text: 'bom dia', bold: false }])
  })

  it('reconhece negrito de markdown (**) do modelo', () => {
    expect(parseRichText('a **Unidade Principal** b')).toEqual([
      { text: 'a ', bold: false },
      { text: 'Unidade Principal', bold: true },
      { text: ' b', bold: false },
    ])
  })

  it('reconhece negrito do WhatsApp (*)', () => {
    expect(parseRichText('*hoje* às 14h')).toEqual([
      { text: 'hoje', bold: true },
      { text: ' às 14h', bold: false },
    ])
  })

  it('não confunde bullet no início da linha com negrito', () => {
    expect(parseRichText('* item um\n* item dois')).toEqual([
      { text: '* item um\n* item dois', bold: false },
    ])
  })

  it('asterisco sem par continua literal', () => {
    expect(parseRichText('2 * 3 e **solto')).toEqual([{ text: '2 * 3 e **solto', bold: false }])
  })

  it('não atravessa quebra de linha', () => {
    expect(parseRichText('*abre\nfecha*')).toEqual([{ text: '*abre\nfecha*', bold: false }])
  })

  it('pega vários negritos na mesma mensagem', () => {
    expect(parseRichText('**Paulista** e **Asa Norte**')).toEqual([
      { text: 'Paulista', bold: true },
      { text: ' e ', bold: false },
      { text: 'Asa Norte', bold: true },
    ])
  })

  it('texto vazio não gera trechos', () => {
    expect(parseRichText('')).toEqual([])
  })

  it('reconhece negrito de underline duplo', () => {
    expect(parseRichText('__hoje__')).toEqual([{ text: 'hoje', bold: true }])
  })
})

describe('toWhatsAppMarkup', () => {
  it('converte ** do markdown para o asterisco único do WhatsApp', () => {
    expect(toWhatsAppMarkup('• **Unidade Principal** - Av. Paulista')).toBe(
      '• *Unidade Principal* - Av. Paulista'
    )
  })

  it('converte __ do markdown', () => {
    expect(toWhatsAppMarkup('__Teste 2__ na Asa Norte')).toBe('*Teste 2* na Asa Norte')
  })

  it('deixa intacto o negrito que já está no formato do WhatsApp', () => {
    expect(toWhatsAppMarkup('*hoje* às 14h')).toBe('*hoje* às 14h')
  })

  it('não mexe em texto sem marcação', () => {
    expect(toWhatsAppMarkup('Qual você escolhe?')).toBe('Qual você escolhe?')
  })

  it('preserva asterisco solto e multiplicação', () => {
    expect(toWhatsAppMarkup('2 * 3 e **solto')).toBe('2 * 3 e **solto')
  })

  it('converte vários negritos na mesma mensagem', () => {
    expect(toWhatsAppMarkup('**Paulista** e **Asa Norte**')).toBe('*Paulista* e *Asa Norte*')
  })
})
