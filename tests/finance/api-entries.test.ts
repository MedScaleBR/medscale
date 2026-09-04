import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' as string }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client, createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: g.role, modules: ['finance'] },
  }),
  requireModule: () => null,
  requireRole: (s: { role: string }, roles: string[]) =>
    roles.includes(s.role) ? null : new Response('{}', { status: 403 }),
}))

import { POST } from '@/app/api/finance/entries/route'
import { PATCH, DELETE } from '@/app/api/finance/entries/[id]/route'

const CATS = [
  { id: 'fil', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'esc', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: 'fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
]
// Mesma árvore, mas a raiz está arquivada — valor legal para um lançamento
// que já existia.
const CATS_ARCHIVED = [
  { id: 'fil', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: true, created_at: '' },
  { id: 'esc', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: 'fil', name: 'Escola', sort_order: 0, is_archived: true, created_at: '' },
]
// Categoria de receita PJ — usada nos testes de direction:'in'.
const CATS_IN = [
  { id: 'rec', account_id: 'a1', kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]
const body = (o: Record<string, unknown>) =>
  new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(o), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { g.role = 'owner' })

describe('POST /api/finance/entries', () => {
  it('cria com recorded_by_phone=web e devolve 201', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { insert: { data: { id: 'e-new' } } },
    })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 120, category_id: 'fil', subcategory_id: 'esc' }) as never)
    expect(res.status).toBe(201)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).recorded_by_phone).toBe('web')
    expect((ins.payload as Record<string, unknown>).raw_message).toBe('(lançado na tela)')
    // `category` (texto) é o snapshot do nome da categoria-raiz resolvido da
    // árvore — não mais null no caminho web (FIX 2 da revisão final).
    expect((ins.payload as Record<string, unknown>).category).toBe('Filhos')
    expect((ins.payload as Record<string, unknown>).category_id).toBe('fil')
    expect((ins.payload as Record<string, unknown>).subcategory_id).toBe('esc')
    expect((await res.json()).id).toBe('e-new')
  })
  it('400 para subcategoria de outra categoria', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: CATS } } })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10, category_id: 'fil', subcategory_id: 'nope' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBeTruthy()
  })
  it('400 se workspace_id não pertence à conta', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      workspaces: { select: { data: null } },
    })
    const res = await POST(body({ type: 'pj', entry_date: '2026-09-01', amount: 10, workspace_id: 'w-outra' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('workspace_invalid')
  })
  it('PJ grava workspace_id quando a unidade pertence à conta', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      workspaces: { select: { data: { id: 'w-ok' } } },
      finance_entries: { insert: { data: { id: 'e-pj' } } },
    })
    const res = await POST(body({ type: 'pj', entry_date: '2026-09-01', amount: 50, workspace_id: 'w-ok' }) as never)
    expect(res.status).toBe(201)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).workspace_id).toBe('w-ok')
    expect((ins.payload as Record<string, unknown>).type).toBe('pj')
  })
  it('sem direction grava out', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { insert: { data: { id: 'e-out' } } },
    })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10 }) as never)
    expect(res.status).toBe(201)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).direction).toBe('out')
  })
  it('receita com categoria in grava direction in', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS_IN } },
      workspaces: { select: { data: { id: 'w1' } } },
      finance_entries: { insert: { data: { id: 'e-in' } } },
    })
    const res = await POST(body({
      type: 'pj', entry_date: '2026-09-01', amount: 300, direction: 'in', category_id: 'rec', workspace_id: 'w1',
    }) as never)
    expect(res.status).toBe(201)
    const ins = g.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).direction).toBe('in')
    expect((ins.payload as Record<string, unknown>).category).toBe('Consultas particulares')
    expect((ins.payload as Record<string, unknown>).category_id).toBe('rec')
  })
  it('400 quando a categoria é de direção diferente do lançamento', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: CATS } } })
    const res = await POST(body({ type: 'pf', entry_date: '2026-09-01', amount: 10, direction: 'in', category_id: 'fil' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('category_direction_mismatch')
  })
})

describe('PATCH/DELETE /api/finance/entries/[id]', () => {
  it('PATCH atualiza amount', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out' } }, update: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 99 }), headers: { 'content-type': 'application/json' } }) as never, params('e1') as never)
    expect(res.status).toBe(200)
    const upd = g.supabase.callsTo('finance_entries', 'update')[0]
    expect((upd.payload as Record<string, unknown>).amount).toBe(99)
    // `type` nunca vai no patch, mesmo se enviado no body.
    expect((upd.payload as Record<string, unknown>).type).toBeUndefined()
  })
  it('PATCH grava o snapshot category quando category_id muda', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out' } }, update: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ category_id: 'fil' }), headers: { 'content-type': 'application/json' } }) as never, params('e1') as never)
    expect(res.status).toBe(200)
    const upd = g.supabase.callsTo('finance_entries', 'update')[0]
    expect((upd.payload as Record<string, unknown>).category_id).toBe('fil')
    expect((upd.payload as Record<string, unknown>).category).toBe('Filhos')
  })
  it('PATCH não toca em category quando category_id não veio no body', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out' } }, update: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 12 }), headers: { 'content-type': 'application/json' } }) as never, params('e1') as never)
    expect(res.status).toBe(200)
    const upd = g.supabase.callsTo('finance_entries', 'update')[0]
    expect('category' in (upd.payload as Record<string, unknown>)).toBe(false)
  })
  it('PATCH permite editar lançamento cuja categoria foi arquivada (FIX 3)', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS_ARCHIVED } },
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out' } }, update: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 50, category_id: 'fil', subcategory_id: 'esc' }), headers: { 'content-type': 'application/json' } }) as never, params('e1') as never)
    expect(res.status).toBe(200)
    const upd = g.supabase.callsTo('finance_entries', 'update')[0]
    expect((upd.payload as Record<string, unknown>).amount).toBe(50)
    expect((upd.payload as Record<string, unknown>).category).toBe('Filhos')
  })
  it('PATCH 404 quando o lançamento não existe na conta', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: null } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 5 }), headers: { 'content-type': 'application/json' } }) as never, params('nao-existe') as never)
    expect(res.status).toBe(404)
  })
  it('DELETE remove', async () => {
    g.supabase = createSupabaseMock({
      // mock ignora filtros; `delete` precisa devolver count>0 para não dar 404.
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out' } }, delete: { data: null, count: 1 } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('e1') as never)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
  it('DELETE 404 quando o count é zero', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: { id: 'e1', account_id: 'a1', type: 'pf', revenue_entry_id: null } }, delete: { data: null, count: 0 } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('e1') as never)
    expect(res.status).toBe(404)
  })
  it('PATCH 409 em lançamento gerido pelo ciclo de receita', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: CATS } },
      finance_entries: { select: { data: { id: 'm1', account_id: 'a1', type: 'pj', direction: 'in', revenue_entry_id: 're1' } } },
    })
    const res = await PATCH(new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify({ amount: 1 }), headers: { 'content-type': 'application/json' } }) as never, params('m1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('revenue_mirror_locked')
  })
  it('DELETE 409 em lançamento gerido pelo ciclo de receita', async () => {
    g.supabase = createSupabaseMock({
      finance_entries: { select: { data: { id: 'm1', account_id: 'a1', type: 'pj', direction: 'in', revenue_entry_id: 're1' } } },
    })
    const res = await DELETE(new Request('https://app.test/x', { method: 'DELETE' }) as never, params('m1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('revenue_mirror_locked')
  })
})
