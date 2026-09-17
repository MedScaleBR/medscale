import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/crypto', () => ({
  encryptToken: (t: string) => `enc:${t}`,
  decryptToken: (t: string) => {
    if (!t.startsWith('enc:')) throw new Error('bad auth tag')
    return t.replace(/^enc:/, '')
  },
}))

import { getAdsAuthUrl, exchangeAdsCodeAndSave, getValidAdsToken } from '@/lib/meta/ads-oauth'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'app-123')
  vi.stubEnv('META_APP_SECRET', 'segredo')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.medscalebr.com')
  g.supabase = createSupabaseMock()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('getAdsAuthUrl', () => {
  it('pede ads_read e business_management e leva o accountId no state', () => {
    const url = new URL(getAdsAuthUrl('acc1'))

    expect(url.searchParams.get('client_id')).toBe('app-123')
    expect(url.searchParams.get('state')).toBe('acc1')
    expect(url.searchParams.get('scope')).toBe('ads_read,business_management')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.medscalebr.com/api/meta/ads/callback')
  })
})

describe('exchangeAdsCodeAndSave', () => {
  it('promove o token curto a longo e salva cifrado com validade', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'curto' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'longo', expires_in: 5184000 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'fb-user-1' }), { status: 200 }))

    await exchangeAdsCodeAndSave('code-1', 'acc1', 'u1')

    const upsert = g.supabase.callsTo('meta_ads_connections', 'upsert')[0]
    expect(upsert.payload).toMatchObject({
      account_id: 'acc1',
      fb_user_id: 'fb-user-1',
      access_token: 'enc:longo',
      connected_by: 'u1',
      is_valid: true,
      scopes: ['ads_read', 'business_management'],
    })
    expect(new Date((upsert.payload as { token_expires_at: string }).token_expires_at).getTime()).toBeGreaterThan(
      Date.now()
    )
  })
})

describe('getValidAdsToken', () => {
  it('devolve o token decifrado quando a conexão é válida', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: {
        select: { data: { access_token: 'enc:longo', is_valid: true, token_expires_at: null }, error: null },
      },
    })

    await expect(getValidAdsToken('acc1')).resolves.toBe('longo')
  })

  it('devolve null quando a conexão foi marcada inválida', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: {
        select: { data: { access_token: 'enc:longo', is_valid: false, token_expires_at: null }, error: null },
      },
    })

    await expect(getValidAdsToken('acc1')).resolves.toBeNull()
  })

  it('devolve null quando não há conexão', async () => {
    g.supabase = createSupabaseMock({ meta_ads_connections: { select: { data: null, error: null } } })

    await expect(getValidAdsToken('acc1')).resolves.toBeNull()
  })

  it('devolve null quando o token salvo não decifra', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: {
        select: { data: { access_token: 'corrompido', is_valid: true, token_expires_at: null }, error: null },
      },
    })

    await expect(getValidAdsToken('acc1')).resolves.toBeNull()
  })
})
