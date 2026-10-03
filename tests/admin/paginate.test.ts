import { describe, it, expect, vi } from 'vitest'
import { fetchAllPages, PAGE_SIZE } from '@/lib/supabase/paginate'

// Simula o PostgREST: devolve o intervalo pedido, cortado em `maxRows`.
function table(total: number, maxRows = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }))
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + maxRows)),
    error: null,
  }))
}

describe('fetchAllPages', () => {
  it('junta blocos de 1000 até um bloco incompleto', async () => {
    const page = table(2500)
    const res = await fetchAllPages(page)
    expect(res).toMatchObject({ truncated: false, error: null })
    expect(res.rows).toHaveLength(2500)
    expect(res.rows[2499]).toEqual({ n: 2499 })
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('múltiplo exato de 1000 precisa de um bloco vazio para saber que acabou', async () => {
    const page = table(2000)
    const res = await fetchAllPages(page)
    expect(res.rows).toHaveLength(2000)
    expect(res.truncated).toBe(false)
    expect(page).toHaveBeenCalledTimes(3)
  })

  it('para no teto e marca truncated; o último bloco só pede o que falta', async () => {
    const page = table(5000)
    const res = await fetchAllPages(page, { max: 1500 })
    expect(res.rows).toHaveLength(1500)
    expect(res.truncated).toBe(true)
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1499],
    ])
  })

  it('exatamente no teto sem mais linhas também conta como truncated (não dá para saber)', async () => {
    const res = await fetchAllPages(table(1000), { max: 1000 })
    expect(res.rows).toHaveLength(1000)
    expect(res.truncated).toBe(true)
  })

  it('erro devolve a mensagem e o que veio antes', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({})), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    const res = await fetchAllPages(page)
    expect(res).toMatchObject({ truncated: false, error: 'timeout' })
    expect(res.rows).toHaveLength(1000)
  })

  it('tabela vazia: uma consulta, nada truncado', async () => {
    const page = table(0)
    expect(await fetchAllPages(page)).toEqual({ rows: [], truncated: false, error: null })
    expect(page).toHaveBeenCalledTimes(1)
  })
})
