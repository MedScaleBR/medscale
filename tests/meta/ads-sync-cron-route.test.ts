import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))

const syncAdsForAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/ads-sync', () => ({ syncAdsForAccount }))

const captureException = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { POST } from '@/app/api/cron/meta-ads-sync/route'

const CRON_SECRET = 'cron-secret-test'

function request(secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/cron/meta-ads-sync', { method: 'POST', headers }) as never
}

beforeEach(() => {
  syncAdsForAccount.mockReset()
  captureException.mockReset()
  g.supabase = createSupabaseMock({
    meta_ads_connections: {
      select: { data: [{ account_id: 'acc1' }, { account_id: 'acc2' }], error: null },
    },
  })
})

describe('POST /api/cron/meta-ads-sync', () => {
  it('sem header de autorização devolve 401 e não consulta o banco', async () => {
    const res = await POST(request(null))

    expect(res.status).toBe(401)
    expect(g.supabase.callsTo('meta_ads_connections', 'select')).toHaveLength(0)
  })

  it('com secret errado devolve 401', async () => {
    const res = await POST(request('secret-errado'))
    expect(res.status).toBe(401)
  })

  it('soma o synced de todas as accounts com conexão válida', async () => {
    syncAdsForAccount
      .mockResolvedValueOnce({ synced: 3, skipped: null })
      .mockResolvedValueOnce({ synced: 2, skipped: null })

    const res = await POST(request())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      accounts: 2,
      synced: 5,
      skipped: { no_token: 0, token_expired: 0 },
    })
    expect(syncAdsForAccount).toHaveBeenCalledWith('acc1')
    expect(syncAdsForAccount).toHaveBeenCalledWith('acc2')

    const select = g.supabase.callsTo('meta_ads_connections', 'select')[0]
    expect(select.filters).toContainEqual(['eq', 'is_valid', true])
  })

  it('conta separadamente accounts puladas por token ausente/expirado', async () => {
    syncAdsForAccount
      .mockResolvedValueOnce({ synced: 0, skipped: 'no_token' })
      .mockResolvedValueOnce({ synced: 0, skipped: 'token_expired' })

    const res = await POST(request())

    await expect(res.json()).resolves.toEqual({
      accounts: 2,
      synced: 0,
      skipped: { no_token: 1, token_expired: 1 },
    })
  })

  it('uma account que lança erro inesperado não derruba o sync das demais', async () => {
    syncAdsForAccount
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ synced: 4, skipped: null })

    const res = await POST(request())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      accounts: 2,
      synced: 4,
      skipped: { no_token: 0, token_expired: 0 },
    })
    expect(syncAdsForAccount).toHaveBeenCalledTimes(2)
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('sem conexões válidas devolve zeros sem chamar o sync', async () => {
    g.supabase = createSupabaseMock({
      meta_ads_connections: { select: { data: [], error: null } },
    })

    const res = await POST(request())

    await expect(res.json()).resolves.toEqual({
      accounts: 0,
      synced: 0,
      skipped: { no_token: 0, token_expired: 0 },
    })
    expect(syncAdsForAccount).not.toHaveBeenCalled()
  })

  it('nunca inclui o segredo de cron na resposta', async () => {
    syncAdsForAccount.mockResolvedValue({ synced: 1, skipped: null })

    const res = await POST(request())
    const text = await res.text()

    expect(text).not.toContain(CRON_SECRET)
  })
})
