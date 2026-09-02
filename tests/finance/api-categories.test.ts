import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' as string }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: g.role, modules: ['finance'] },
  }),
  requireModule: () => null,
  requireRole: (s: { role: string }, roles: string[]) =>
    roles.includes(s.role) ? null : new Response(JSON.stringify({ error: 'nope' }), { status: 403 }),
}))

import { GET, POST } from '@/app/api/finance/categories/route'

const CAT_ROWS = [
  { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
]

function req(body?: unknown, url = 'https://app.test/api/finance/categories') {
  return new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => { g.role = 'owner' })

describe('GET /api/finance/categories', () => {
  it('403 para não-owner', async () => {
    g.role = 'admin'
    g.supabase = createSupabaseMock()
    const res = await GET(req() as never)
    expect(res.status).toBe(403)
  })
  it('devolve a árvore com entryCount', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CAT_ROWS } },
      finance_entries: { select: { data: [{ category_id: 'r1', subcategory_id: null }] } },
    })
    const res = await GET(req() as never)
    const json = await res.json()
    expect(json.pf[0].entryCount).toBe(1)
  })
})

describe('POST /api/finance/categories', () => {
  it('400 com code para nome vazio', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: CAT_ROWS } } })
    const res = await POST(req({ kind: 'pf', name: '  ' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('empty_name')
  })
  it('insere e devolve 201 com id', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CAT_ROWS }, insert: { data: { id: 'new-1' } } },
    })
    const res = await POST(req({ kind: 'pf', name: 'Pets' }) as never)
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('new-1')
  })
})

import { PATCH, DELETE } from '@/app/api/finance/categories/[id]/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('PATCH /api/finance/categories/[id]', () => {
  it('arquivar raiz cascateia para os filhos', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: {
        select: { data: [
          { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
          { id: 's1', account_id: 'a1', kind: 'pf', parent_id: 'r1', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
        ] },
        update: { data: null },
      },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ is_archived: true }), headers: { 'content-type': 'application/json' } }) as never, params('r1') as never)
    expect(res.status).toBe(200)
    const updates = g.supabase.callsTo('finance_categories', 'update')
    expect(updates.length).toBeGreaterThanOrEqual(1) // raiz + filhos (via .in ou 2ª chamada)
  })
  it('400 ao renomear para nome de irmã existente', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
        { id: 'r2', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Alimentação', sort_order: 1, is_archived: false, created_at: '' },
      ] } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ name: 'alimentacao' }), headers: { 'content-type': 'application/json' } }) as never, params('r1') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('duplicate_sibling')
  })
})

describe('DELETE /api/finance/categories/[id]', () => {
  it('409 quando há lançamentos usando', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
      ] } },
      finance_entries: { select: { data: [{ id: 'e1' }] } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('r1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('in_use')
  })
  it('200 quando vazia', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [
        { id: 'r1', account_id: 'a1', kind: 'pf', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
      ] }, delete: { data: null } },
      finance_entries: { select: { data: [] } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('r1') as never)
    expect(res.status).toBe(200)
  })
})
