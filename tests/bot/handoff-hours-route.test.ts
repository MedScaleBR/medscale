import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/session/api')>(),
  requireWorkspaceSession: async () => ({ session: { accountId: 'acc1', workspaceId: 'w1', userId: 'u1', role: g.role, modules: [] } }),
}))
import { GET, POST } from '@/app/api/bot/handoff-hours/route'
import { DELETE } from '@/app/api/bot/handoff-hours/[id]/route'

const req = (method: string, scope = 'global', body?: unknown) => new NextRequest(`https://app.test/api/bot/handoff-hours?scope=${scope}`, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
})
describe('horário humano Global', () => {
  beforeEach(() => {
    g.role = 'owner'
    g.supabase = createSupabaseMock({ account_handoff_hours: { select: { data: [{ id: 'global1' }] }, insert: { data: { id: 'global1' } }, delete: { data: null } } })
  })
  it('lê somente o Global da conta autenticada', async () => {
    const res = await GET(req('GET'))
    expect(await res.json()).toEqual([{ id: 'global1' }])
    expect(g.supabase.callsTo('account_handoff_hours')[0]?.filters).toContainEqual(['eq', 'account_id', 'acc1'])
  })
  it('grava Global na conta da sessão, ignorando conta enviada pelo cliente', async () => {
    const res = await POST(req('POST', 'global', { account_id: 'foreign', day_of_week: 1, start_time: '08:00', end_time: '17:00' }))
    expect(res.status).toBe(201)
    expect(g.supabase.callsTo('account_handoff_hours', 'insert')[0]?.payload).toEqual({ account_id: 'acc1', day_of_week: 1, start_time: '08:00', end_time: '17:00', is_active: true })
  })
  it('limita a exclusão Global à conta autenticada', async () => {
    const res = await DELETE(req('DELETE'), { params: Promise.resolve({ id: 'global1' }) })
    expect(res.status).toBe(200)
    expect(g.supabase.callsTo('account_handoff_hours', 'delete')[0]?.filters).toContainEqual(['eq', 'account_id', 'acc1'])
  })
  it('impede membro de alterar horário humano', async () => {
    g.role = 'member'
    const res = await POST(req('POST', 'global', { day_of_week: 1, start_time: '08:00', end_time: '17:00' }))
    expect(res.status).toBe(403)
    expect(g.supabase.calls).toHaveLength(0)
  })
  it.each([
    { day_of_week: 7, start_time: '08:00', end_time: '17:00' },
    { day_of_week: 1, start_time: '17:00', end_time: '08:00' },
    { day_of_week: 1, start_time: '25:00', end_time: '26:00' },
  ])('rejeita horário inválido: %j', async (body) => {
    expect((await POST(req('POST', 'global', body))).status).toBe(400)
    expect(g.supabase.calls).toHaveLength(0)
  })
})
