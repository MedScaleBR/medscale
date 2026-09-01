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
})
