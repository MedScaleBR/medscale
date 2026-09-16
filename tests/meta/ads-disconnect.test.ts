import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner' as string, modules: [] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})

import { DELETE } from '@/app/api/meta/ads/disconnect/route'

const req = () => new NextRequest('http://localhost/api/meta/ads/disconnect', { method: 'DELETE' })

beforeEach(() => {
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  g.supabase = createSupabaseMock()
})

describe('DELETE /api/meta/ads/disconnect', () => {
  it('apaga a conexão e os mapeamentos de conta de anúncio da account', async () => {
    const res = await DELETE(req())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const connDelete = g.supabase.callsTo('meta_ads_connections', 'delete')[0]
    expect(connDelete.filters).toContainEqual(['eq', 'account_id', 'acc1'])

    const mapDelete = g.supabase.callsTo('workspace_ad_accounts', 'delete')[0]
    expect(mapDelete.filters).toContainEqual(['eq', 'account_id', 'acc1'])
  })

  it('member recebe 403 e não apaga nada', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await DELETE(req())

    expect(res.status).toBe(403)
    expect(g.supabase.callsTo('meta_ads_connections', 'delete')).toHaveLength(0)
  })

  it('erro do banco ao apagar a conexão devolve 500', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: { delete: { data: null, error: { message: 'boom' } } },
    })

    const res = await DELETE(req())

    expect(res.status).toBe(500)
  })
})
