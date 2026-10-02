import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))

import { POST } from '@/app/api/admin/tasks/route'
import { PATCH } from '@/app/api/admin/tasks/[taskId]/route'

function setup(config: SupabaseMockConfig = {}, { user = true, admin = true } = {}) {
  g.supabase = createSupabaseMock(config)
  g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: user ? { id: 'admin1' } : null }, error: null })
  g.supabase.rpc.mockResolvedValue({ data: admin, error: null })
  return g.supabase
}

const req = (method: string, body: unknown) =>
  new NextRequest('https://app.test/api/admin/tasks', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const patch = (body: unknown, taskId = 't1') => PATCH(req('PATCH', body), { params: Promise.resolve({ taskId }) })

describe('POST /api/admin/tasks', () => {
  beforeEach(() => setup())

  it('responde 401/403 em pt-BR sem sessão ou sem admin', async () => {
    setup({}, { user: false })
    let res = await POST(req('POST', { title: 'x' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Não autenticado' })

    setup({}, { admin: false })
    res = await POST(req('POST', { title: 'x' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Acesso negado' })
  })

  it('cria com status todo e position 0 por padrão (201)', async () => {
    const s = setup({ account_tasks: { insert: { data: { id: 't1' } } } })
    const res = await POST(req('POST', { title: '  Ligar  ' }))
    expect(res.status).toBe(201)
    const [call] = s.callsTo('account_tasks', 'insert')
    expect(call.payload).toMatchObject({
      title: 'Ligar',
      status: 'todo',
      position: 0,
      source_type: null,
      source_ref: null,
      completed_at: null,
      created_by: 'admin1',
    })
  })

  it('preenche completed_at quando já nasce done', async () => {
    const s = setup({ account_tasks: { insert: { data: { id: 't1' } } } })
    await POST(req('POST', { title: 'x', status: 'done' }))
    const [call] = s.callsTo('account_tasks', 'insert')
    expect((call.payload as { completed_at: string | null }).completed_at).toEqual(expect.any(String))
  })

  it('rejeita status, source_type e position inválidos com 400', async () => {
    for (const body of [
      { title: 'x', status: 'pending' },
      { title: 'x', source_type: 'outro', source_ref: 'r' },
      { title: 'x', source_type: 'feedback' },
      { title: 'x', position: 'abc' },
    ]) {
      const res = await POST(req('POST', body))
      expect(res.status).toBe(400)
    }
    expect(g.supabase.callsTo('account_tasks', 'insert')).toHaveLength(0)
  })

  it('em 23505 devolve 200 com a tarefa existente da mesma origem', async () => {
    const existing = { id: 'old', source_type: 'feedback', source_ref: 'f1' }
    const s = setup({
      account_tasks: {
        insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
        select: { data: existing },
      },
    })
    const res = await POST(req('POST', { title: 'x', source_type: 'feedback', source_ref: 'f1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(existing)
    const [lookup] = s.callsTo('account_tasks', 'select')
    expect(filterValue(lookup, 'eq', 'source_type')).toBe('feedback')
    expect(filterValue(lookup, 'eq', 'source_ref')).toBe('f1')
  })

  it('não vaza a mensagem do Postgres em erro 500', async () => {
    setup({ account_tasks: { insert: { data: null, error: { code: '42P01', message: 'relation does not exist' } } } })
    const res = await POST(req('POST', { title: 'x' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Não foi possível salvar a tarefa' })
  })
})

describe('PATCH /api/admin/tasks/[taskId]', () => {
  it('rejeita status inválido com 400 sem tocar no banco', async () => {
    const s = setup()
    const res = await patch({ status: 'pending' })
    expect(res.status).toBe(400)
    expect(s.callsTo('account_tasks')).toHaveLength(0)
  })

  it('rejeita position não finita', async () => {
    setup()
    const res = await patch({ position: null })
    expect(res.status).toBe(400)
  })

  it('preenche completed_at ao ir para done e limpa ao sair', async () => {
    const s = setup({ account_tasks: { update: { data: { id: 't1', source_type: null, source_ref: null } } } })
    await patch({ status: 'done' })
    await patch({ status: 'doing' })
    const [toDone, toDoing] = s.callsTo('account_tasks', 'update')
    expect((toDone.payload as { completed_at: string }).completed_at).toEqual(expect.any(String))
    expect(toDoing.payload).toMatchObject({ status: 'doing', completed_at: null })
  })

  it('não mexe em completed_at quando só move a posição', async () => {
    const s = setup({ account_tasks: { update: { data: { id: 't1' } } } })
    await patch({ position: 1.5 })
    const [call] = s.callsTo('account_tasks', 'update')
    expect(call.payload).toEqual({ position: 1.5 })
  })

  it('marca o feedback de origem como reviewed ao concluir', async () => {
    const s = setup({ account_tasks: { update: { data: { id: 't1', source_type: 'feedback', source_ref: 'f1' } } } })
    const res = await patch({ status: 'done' })
    expect(res.status).toBe(200)
    const [fb] = s.callsTo('feedback', 'update')
    expect(fb.payload).toEqual({ status: 'reviewed' })
    expect(filterValue(fb, 'eq', 'id')).toBe('f1')
  })

  it('falha ao marcar o feedback não derruba a requisição', async () => {
    setup({
      account_tasks: { update: { data: { id: 't1', source_type: 'feedback', source_ref: 'f1' } } },
      feedback: { update: { data: null, error: { message: 'boom' } } },
    })
    const res = await patch({ status: 'done' })
    expect(res.status).toBe(200)
  })

  it('não toca no feedback quando a tarefa não vem de feedback', async () => {
    const s = setup({ account_tasks: { update: { data: { id: 't1', source_type: 'cost_alert', source_ref: 'x' } } } })
    await patch({ status: 'done' })
    expect(s.callsTo('feedback')).toHaveLength(0)
  })
})
