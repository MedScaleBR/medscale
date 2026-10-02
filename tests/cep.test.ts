import { describe, it, expect, vi, afterEach } from 'vitest'
import { maskCep, lookupCep } from '@/lib/cep'

afterEach(() => vi.unstubAllGlobals())

describe('maskCep', () => {
  it('mantém só 8 dígitos e coloca o hífen', () => {
    expect(maskCep('01310-100x9')).toEqual({ digits: '01310100', masked: '01310-100' })
    expect(maskCep('0131')).toEqual({ digits: '0131', masked: '0131' })
  })
})

describe('lookupCep', () => {
  it('monta endereço, cidade e UF a partir do ViaCEP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ logradouro: 'Av. Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
    })))
    expect(await lookupCep('01310100')).toEqual({ address: 'Av. Paulista, Bela Vista', city: 'São Paulo', state: 'SP' })
  })

  it('devolve null para CEP inexistente ou falha de rede', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ erro: true }) })))
    expect(await lookupCep('00000000')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await lookupCep('01310100')).toBeNull()
  })
})
