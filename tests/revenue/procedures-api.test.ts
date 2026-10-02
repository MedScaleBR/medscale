import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireRole: (session: { role: string }, roles: string[]) =>
      roles.includes(session.role) ? null : NR.json({ error: 'forbidden' }, { status: 403 }),
    requireModule: (session: { modules: string[] }, module: string) =>
      session.modules.includes(module) ? null : NR.json({ error: 'module' }, { status: 403 }),
  }
})

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/procedures/route'
import { PATCH, DELETE } from '@/app/api/procedures/[id]/route'

const BASE = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', modules: [] as string[] }
const req = (method: string, body?: unknown) =>
  new NextRequest('https://app.test/api/procedures', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  } as never)
const params = { params: Promise.resolve({ id: 'p1' }) }

describe('catálogo de procedimentos — escrita', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({
      procedure_catalog: { insert: { data: { id: 'p1', name: 'Consulta' } }, update: { data: { id: 'p1' } } },
    })
  })

  it('admin cadastra procedimento mesmo sem o módulo de receita', async () => {
    g.session = { ...BASE, role: 'admin' }
    const res = (await POST(req('POST', { name: 'Consulta', default_price: 300 }))) as NextResponse
    expect(res.status).toBe(201)
    const [call] = g.supabase.callsTo('procedure_catalog', 'insert')
    expect(call.payload).toMatchObject({ workspace_id: 'w1', name: 'Consulta', default_price: 300 })
  })

  it('admin edita e remove procedimento', async () => {
    g.session = { ...BASE, role: 'admin' }
    const patchRes = (await PATCH(req('PATCH', { default_price: 350 }), params)) as NextResponse
    expect(patchRes.status).toBe(200)
    const deleteRes = (await DELETE(req('DELETE'), params)) as NextResponse
    expect(deleteRes.status).toBe(200)
  })

  it('member não grava no catálogo', async () => {
    g.session = { ...BASE, role: 'member' }
    const postRes = (await POST(req('POST', { name: 'Consulta', default_price: 300 }))) as NextResponse
    expect(postRes.status).toBe(403)
    const patchRes = (await PATCH(req('PATCH', { default_price: 1 }), params)) as NextResponse
    expect(patchRes.status).toBe(403)
    const deleteRes = (await DELETE(req('DELETE'), params)) as NextResponse
    expect(deleteRes.status).toBe(403)
    expect(g.supabase.callsTo('procedure_catalog')).toHaveLength(0)
  })
})
