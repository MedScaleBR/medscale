import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock } from '../helpers/supabase-mock'
import { ensureFinanceCategories } from '@/lib/finance/provision'

describe('ensureFinanceCategories', () => {
  it('chama o RPC provision_finance_categories com a conta e a árvore', async () => {
    const mock = createSupabaseMock()
    await ensureFinanceCategories(mock.client as never, 'acc-1')
    expect(mock.rpc).toHaveBeenCalledWith(
      'provision_finance_categories',
      expect.objectContaining({
        p_account_id: 'acc-1',
        p_tree: expect.objectContaining({ pf: expect.any(Array), pj: expect.any(Array) }),
      })
    )
  })

  it('propaga erro do RPC', async () => {
    const mock = createSupabaseMock()
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).rejects.toThrow('boom')
  })

  it('degrada silenciosamente quando a função ainda não existe (código 42883)', async () => {
    const mock = createSupabaseMock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function provision_finance_categories(uuid, jsonb) does not exist' },
    })
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('degrada quando a mensagem indica função ausente sem código', async () => {
    const mock = createSupabaseMock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not find the function public.provision_finance_categories in the schema cache' },
    })
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('também chama ensure_finance_income_seed com a conta', async () => {
    const mock = createSupabaseMock()
    await ensureFinanceCategories(mock.client as never, 'acc-1')
    expect(mock.rpc).toHaveBeenCalledWith('ensure_finance_income_seed', { p_account_id: 'acc-1' })
  })

  it('propaga erro do ensure_finance_income_seed', async () => {
    const mock = createSupabaseMock()
    mock.rpc
      .mockResolvedValueOnce({ data: null, error: null }) // provision_finance_categories
      .mockResolvedValueOnce({ data: null, error: { message: 'boom-seed' } }) // ensure_finance_income_seed
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).rejects.toThrow('boom-seed')
  })

  it('degrada silenciosamente quando ensure_finance_income_seed ainda não existe', async () => {
    const mock = createSupabaseMock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.rpc
      .mockResolvedValueOnce({ data: null, error: null }) // provision_finance_categories
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42883', message: 'function ensure_finance_income_seed(uuid) does not exist' },
      })
    await expect(ensureFinanceCategories(mock.client as never, 'acc-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
