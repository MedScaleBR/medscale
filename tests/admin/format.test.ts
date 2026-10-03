import { describe, expect, it } from 'vitest'
import { formatDateBR, formatDateTimeBR, initialsFrom } from '@/lib/admin/format'

describe('initialsFrom', () => {
  it('usa primeira e última palavra do nome', () => {
    expect(initialsFrom('Ana Maria Souza')).toBe('AS')
  })
  it('cai para o e-mail sem nome', () => {
    expect(initialsFrom(null, 'joao.silva@x.com')).toBe('JO')
  })
})

describe('formatDateBR', () => {
  it('não desloca datas puras pelo fuso', () => {
    expect(formatDateBR('2026-10-02')).toBe('02/10/2026')
  })
  it('converte timestamps para o fuso de São Paulo', () => {
    expect(formatDateBR('2026-10-02T01:00:00Z')).toBe('01/10/2026')
  })
})

describe('formatDateTimeBR', () => {
  it('formata data e hora no fuso de São Paulo', () => {
    expect(formatDateTimeBR('2026-10-02T01:05:00Z')).toBe('01/10/2026 22:05')
  })
  it('usa 00h em vez de 24h', () => {
    expect(formatDateTimeBR('2026-10-02T03:30:00Z')).toBe('02/10/2026 00:30')
  })
  it('retorna vazio para valor ausente ou inválido', () => {
    expect(formatDateTimeBR(null)).toBe('')
    expect(formatDateTimeBR('xyz')).toBe('')
  })
})
