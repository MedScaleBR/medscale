import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
const mirror = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: 'owner', modules: ['revenue_cycle'] },
  }),
  requireModule: () => null,
}))
vi.mock('@/lib/revenue/finance-mirror', () => ({ mirrorPaidRevenueToFinance: mirror }))

import { POST as CONFIRM } from '@/app/api/revenue-entries/[id]/confirm/route'
import { POST as CREATE_REVENUE } from '@/app/api/revenue/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown, method = 'POST') =>
  new Request('https://app.test/x', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => mirror.mockClear())

describe('POST /api/revenue-entries/[id]/confirm', () => {
  it('confirmar pagamento chama o espelho com os campos da linha atualizada', async () => {
    g.supabase = createSupabaseMock({
      revenue_entries: {
        select: { data: { id: 're1', payment_status: 'realized' } },
        update: {
          data: {
            id: 're1', account_id: 'a1', workspace_id: 'w1', amount: 250,
            procedure_name: 'Retorno', paid_at: '2026-09-04T12:00:00.000Z',
          },
        },
      },
    })
    const res = await CONFIRM(jsonReq({ payment_method: 'pix' }) as never, params('re1') as never)
    expect(res.status).toBe(200)
    expect(mirror).toHaveBeenCalledWith(expect.anything(), {
      id: 're1', accountId: 'a1', workspaceId: 'w1', amount: 250,
      procedureName: 'Retorno', paidAtIso: '2026-09-04T12:00:00.000Z',
    })
  })

  it('não chama o espelho quando a entrada já está paga (409, update nunca roda)', async () => {
    g.supabase = createSupabaseMock({
      revenue_entries: { select: { data: { id: 're1', payment_status: 'paid' } } },
    })
    const res = await CONFIRM(jsonReq({ payment_method: 'pix' }) as never, params('re1') as never)
    expect(res.status).toBe(409)
    expect(mirror).not.toHaveBeenCalled()
  })
})

describe('POST /api/revenue', () => {
  it('lançamento avulso previsto NÃO chama o espelho', async () => {
    g.supabase = createSupabaseMock({
      revenue_entries: {
        insert: {
          data: { id: 're2', account_id: 'a1', workspace_id: 'w1', amount: 100, procedure_name: null, paid_at: null, payment_status: 'pending' },
        },
      },
    })
    const res = await CREATE_REVENUE(jsonReq({ amount: 100, status: 'previsto' }) as never)
    expect(res.status).toBe(201)
    expect(mirror).not.toHaveBeenCalled()
  })

  it('lançamento avulso confirmado chama o espelho', async () => {
    g.supabase = createSupabaseMock({
      revenue_entries: {
        insert: {
          data: {
            id: 're3', account_id: 'a1', workspace_id: 'w1', amount: 100,
            procedure_name: null, paid_at: '2026-09-04T12:00:00.000Z', payment_status: 'paid',
          },
        },
      },
    })
    const res = await CREATE_REVENUE(jsonReq({ amount: 100, status: 'confirmado', payment_method: 'pix' }) as never)
    expect(res.status).toBe(201)
    expect(mirror).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 're3', amount: 100 }))
  })
})
