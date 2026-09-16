import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const g = vi.hoisted(() => ({
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner' as string, modules: [] },
}))

vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})

const syncAdsForAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/ads-sync', () => ({ syncAdsForAccount }))

import { POST } from '@/app/api/meta/ads/sync/route'

const req = () => new NextRequest('http://localhost/api/meta/ads/sync', { method: 'POST' })

beforeEach(() => {
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  syncAdsForAccount.mockReset()
})

describe('POST /api/meta/ads/sync', () => {
  it('sincroniza a account da sessão e devolve o total sincronizado', async () => {
    syncAdsForAccount.mockResolvedValue({ synced: 5, skipped: null })

    const res = await POST(req())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, synced: 5 })
    expect(syncAdsForAccount).toHaveBeenCalledWith('acc1')
  })

  it('sem conexão devolve 409 pedindo pra conectar', async () => {
    syncAdsForAccount.mockResolvedValue({ synced: 0, skipped: 'no_token' })

    const res = await POST(req())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Conecte sua conta do Facebook primeiro.')
  })

  it('token expirado devolve 409 pedindo pra reconectar', async () => {
    syncAdsForAccount.mockResolvedValue({ synced: 0, skipped: 'token_expired' })

    const res = await POST(req())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Sua conexão com o Facebook expirou. Reconecte nas configurações.')
  })

  it('member recebe 403 e não dispara o sync', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await POST(req())

    expect(res.status).toBe(403)
    expect(syncAdsForAccount).not.toHaveBeenCalled()
  })

  it('nunca inclui token na resposta', async () => {
    syncAdsForAccount.mockResolvedValue({ synced: 2, skipped: null })

    const res = await POST(req())
    const text = await res.text()

    expect(text).not.toMatch(/token/i)
  })
})
