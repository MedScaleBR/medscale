import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const g = vi.hoisted(() => ({
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner' as string, modules: [] },
}))

vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})
vi.mock('@/lib/meta/ads-oauth', () => ({
  isAdsConfigured: vi.fn(() => true),
  getAdsAuthUrl: (accountId: string) => `https://www.facebook.com/v21.0/dialog/oauth?state=${accountId}`,
}))

import { GET } from '@/app/api/meta/ads/connect/route'
import { isAdsConfigured } from '@/lib/meta/ads-oauth'

const req = () => new NextRequest('http://localhost/api/meta/ads/connect')

beforeEach(() => {
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  vi.mocked(isAdsConfigured).mockReturnValue(true)
})

describe('GET /api/meta/ads/connect', () => {
  it('redireciona pro Facebook e grava um cookie de nonce httpOnly/sameSite=lax de uso único', async () => {
    const res = await GET(req())

    expect(res.headers.get('location')).toBe('https://www.facebook.com/v21.0/dialog/oauth?state=acc1')

    const setCookie = res.headers.get('set-cookie') ?? ''
    // Valor = `${accountId}:${nonce}` (URL-encoded: ':' vira %3A) — ver callback/route.ts.
    expect(setCookie).toMatch(/^meta_ads_oauth_nonce=acc1%3A[^;]+/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toMatch(/Path=\/api\/meta\/ads/)
    expect(setCookie).toMatch(/Max-Age=600\b/)
  })

  it('marca o cookie como Secure em produção e não em dev', async () => {
    // `secure: true` fixo impediria exercitar o fluxo por http://localhost, então
    // o flag segue o COOKIE_OPTS de lib/session/actions.ts e depende do ambiente.
    const dev = await GET(req())
    expect(dev.headers.get('set-cookie') ?? '').not.toMatch(/Secure/i)

    vi.stubEnv('NODE_ENV', 'production')
    const prod = await GET(req())
    expect(prod.headers.get('set-cookie') ?? '').toMatch(/Secure/i)
    vi.unstubAllEnvs()
  })

  it('member recebe 403 e não redireciona nem grava cookie', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await GET(req())

    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('sem app configurado devolve 503', async () => {
    vi.mocked(isAdsConfigured).mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(503)
  })
})
