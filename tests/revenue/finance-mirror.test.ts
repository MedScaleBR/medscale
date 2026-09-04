import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn().mockResolvedValue(undefined) }))

import { mirrorPaidRevenueToFinance, unmirrorPaidRevenue, REVENUE_MIRROR_CATEGORY } from '@/lib/revenue/finance-mirror'

const CATS_IN = [
  { id: 'rec', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]

const input = {
  id: 're1',
  accountId: 'a1',
  workspaceId: 'w1',
  amount: 300,
  procedureName: 'Consulta cardiológica',
  paidAtIso: '2026-09-04T17:30:00.000Z',
}

function mock(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock(config)
  return g.supabase
}

describe('mirrorPaidRevenueToFinance', () => {
  it('cria o finance_entry de entrada espelhando o pagamento', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    const p = ins.payload as Record<string, unknown>
    expect(p.direction).toBe('in')
    expect(p.type).toBe('pj')
    expect(p.amount).toBe(300)
    expect(p.account_id).toBe('a1')
    expect(p.workspace_id).toBe('w1')
    // 2026-09-04T17:30:00Z é 2026-09-04 14:30 em São Paulo (-03:00) — mesmo dia.
    expect(p.entry_date).toBe('2026-09-04')
    expect(p.revenue_entry_id).toBe('re1')
    expect(p.category).toBe(REVENUE_MIRROR_CATEGORY)
    expect(p.category_id).toBe('rec')
    expect(p.subcategory_id).toBeNull()
    expect(p.recorded_by_phone).toBe('revenue-cycle')
    expect(p.raw_message).toBe('(ciclo de receita)')
    expect(p.description).toBe('Consulta cardiológica')
  })

  it('é idempotente — não insere se já existe espelho', async () => {
    mock({
      finance_entries: { select: { data: { id: 'fe1' } }, insert: { data: { id: 'x' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    expect(g.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  })

  it('a checagem de idempotência filtra por revenue_entry_id', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    const sel = g.supabase.callsTo('finance_entries', 'select')[0]
    expect(filterValue(sel, 'eq', 'revenue_entry_id')).toBe('re1')
  })

  it('insere com category_id null quando a categoria de receita não existe', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: [] } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, input)
    const p = g.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(p.category_id).toBeNull()
    expect(p.category).toBe(REVENUE_MIRROR_CATEGORY)
  })

  it('não lança quando o insert falha', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: null, error: { message: 'boom' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await expect(mirrorPaidRevenueToFinance(g.supabase.client as never, input)).resolves.toBeUndefined()
  })

  it('não lança quando algo dá errado inesperadamente (ex.: ensureFinanceCategories rejeita)', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    const provision = await import('@/lib/finance/provision')
    vi.mocked(provision.ensureFinanceCategories).mockRejectedValueOnce(new Error('db down'))
    await expect(mirrorPaidRevenueToFinance(g.supabase.client as never, input)).resolves.toBeUndefined()
  })

  it('usa a data de hoje em SP quando paidAtIso é null', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, { ...input, paidAtIso: null })
    const p = g.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(String(p.entry_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('descrição cai para "Consulta" quando não há nome de procedimento', async () => {
    mock({
      finance_entries: { select: { data: null }, insert: { data: { id: 'fe1' } } },
      finance_categories: { select: { data: CATS_IN } },
    })
    await mirrorPaidRevenueToFinance(g.supabase.client as never, { ...input, procedureName: null })
    const p = g.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(p.description).toBe('Consulta')
  })
})

describe('unmirrorPaidRevenue', () => {
  beforeEach(() => {
    mock({ finance_entries: { delete: { data: null, count: 1 } } })
  })

  it('apaga o espelho pela revenue_entry_id', async () => {
    await unmirrorPaidRevenue(g.supabase.client as never, 're1')
    const del = g.supabase.callsTo('finance_entries', 'delete')[0]
    expect(filterValue(del, 'eq', 'revenue_entry_id')).toBe('re1')
  })
})
