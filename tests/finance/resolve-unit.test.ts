import { describe, it, expect, vi } from 'vitest'

// agent.ts arrasta supabase/whatsapp/anthropic no import — mockados para o
// teste da função pura resolveUnit não tocar nada externo.
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }))
vi.mock('@/lib/whatsapp/send', () => ({ sendWhatsAppMessage: vi.fn() }))

import { resolveUnit } from '@/lib/finance/agent'

const UNITS = [
  { id: 'w-moema', name: 'Unidade Moema' },
  { id: 'w-centro', name: 'Unidade Centro' },
  { id: 'w-tatuape', name: 'Tatuapé' },
]

describe('resolveUnit — casar a unidade do lançamento PJ', () => {
  it('resolve direto para a única unidade da account, mesmo sem dica', () => {
    const only = [{ id: 'w1', name: 'Matriz' }]
    expect(resolveUnit(only, null)).toEqual({ status: 'one', unit: only[0] })
    expect(resolveUnit(only, 'qualquer coisa')).toEqual({ status: 'one', unit: only[0] })
  })

  it('sem dica e com várias unidades: none', () => {
    expect(resolveUnit(UNITS, null)).toEqual({ status: 'none' })
  })

  it('casa por número da lista (1-based)', () => {
    expect(resolveUnit(UNITS, '2')).toEqual({ status: 'one', unit: UNITS[1] })
  })

  it('ignora número fora do intervalo', () => {
    expect(resolveUnit(UNITS, '9')).toEqual({ status: 'none' })
  })

  it('casa por trecho do nome, ignorando acento e caixa', () => {
    expect(resolveUnit(UNITS, 'moema')).toEqual({ status: 'one', unit: UNITS[0] })
    expect(resolveUnit(UNITS, 'TATUAPE')).toEqual({ status: 'one', unit: UNITS[2] })
  })

  it('casa quando o texto do usuário contém o nome inteiro da unidade', () => {
    expect(resolveUnit(UNITS, 'foi na Tatuapé mesmo')).toEqual({ status: 'one', unit: UNITS[2] })
  })

  it('marca ambíguo quando a dica casa com mais de uma', () => {
    expect(resolveUnit(UNITS, 'unidade')).toEqual({ status: 'ambiguous' })
  })

  it('none quando nada casa', () => {
    expect(resolveUnit(UNITS, 'Ipanema')).toEqual({ status: 'none' })
  })
})
