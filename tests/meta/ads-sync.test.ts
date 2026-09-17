import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  token: 'tok' as string | null,
  invalidated: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/meta/ads-oauth', () => ({
  getValidAdsToken: () => Promise.resolve(g.token),
  markAdsConnectionInvalid: (id: string) => {
    g.invalidated.push(id)
    return Promise.resolve()
  },
}))

import { syncAdsForAccount, extractLeads } from '@/lib/meta/ads-sync'

const insights = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200 })

beforeEach(() => {
  g.token = 'tok'
  g.invalidated = []
  vi.stubGlobal('fetch', vi.fn())
  g.supabase = createSupabaseMock({
    workspace_ad_accounts: {
      select: { data: [{ workspace_id: 'w1', ad_account_id: 'act_1', account_id: 'acc1' }], error: null },
    },
    ad_campaigns: { upsert: { data: null, error: null } },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractLeads', () => {
  it('soma os tipos de ação que representam lead', () => {
    expect(
      extractLeads([
        { action_type: 'lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '2' },
        { action_type: 'link_click', value: '99' },
      ])
    ).toBe(5)
  })

  it('devolve 0 sem ações', () => {
    expect(extractLeads(undefined)).toBe(0)
  })

  it('ignora um valor não numérico em vez de virar NaN em silêncio', () => {
    expect(extractLeads([{ action_type: 'lead', value: 'não é número' }])).toBe(0)
    expect(
      extractLeads([
        { action_type: 'lead', value: '3' },
        { action_type: 'lead', value: 'lixo' },
      ])
    ).toBe(3)
  })
})

describe('syncAdsForAccount', () => {
  it('grava uma linha por campanha por dia com source meta_sync', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        {
          campaign_id: 'c-1',
          campaign_name: 'Implantes - SP',
          date_start: '2026-09-10',
          date_stop: '2026-09-10',
          spend: '150.50',
          impressions: '2000',
          clicks: '80',
          actions: [{ action_type: 'lead', value: '4' }],
        },
      ])
    )

    const result = await syncAdsForAccount('acc1')

    expect(result).toEqual({ synced: 1, skipped: null })
    const upsert = g.supabase.callsTo('ad_campaigns', 'upsert')[0]
    expect(upsert.payload).toMatchObject([
      {
        workspace_id: 'w1',
        account_id: 'acc1',
        channel: 'facebook',
        source: 'meta_sync',
        external_campaign_id: 'c-1',
        campaign_name: 'Implantes - SP',
        period_start: '2026-09-10',
        period_end: '2026-09-10',
        spend: 150.5,
        impressions: 2000,
        clicks: 80,
        leads: 4,
      },
    ])
  })

  it('é idempotente: roda duas vezes com onConflict e não duplica', async () => {
    // mockImplementation (não mockResolvedValue): syncAdsForAccount roda duas
    // vezes nesse teste, cada uma faz sua própria chamada a fetch, e o body de
    // um Response só pode ser lido uma vez — precisa de uma instância nova por
    // chamada, não da mesma reaproveitada.
    vi.mocked(fetch).mockImplementation(async () =>
      insights([
        {
          campaign_id: 'c-1',
          campaign_name: 'Implantes - SP',
          date_start: '2026-09-10',
          date_stop: '2026-09-10',
          spend: '150.50',
          impressions: '2000',
          clicks: '80',
        },
      ])
    )

    await syncAdsForAccount('acc1')
    await syncAdsForAccount('acc1')

    const calls = g.supabase.callsTo('ad_campaigns', 'upsert')
    expect(calls).toHaveLength(2)
    // O upsert precisa declarar o conflito no índice de unicidade do sync, senão
    // a segunda rodada insere linha nova em vez de atualizar.
    expect(calls.every((c) => (c.options as { onConflict?: string })?.onConflict === 'workspace_id,external_campaign_id,period_start')).toBe(true)
  })

  it('nunca escreve em linhas manuais (só upsert com source meta_sync)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        { campaign_id: 'c-1', campaign_name: 'X', date_start: '2026-09-10', date_stop: '2026-09-10', spend: '1' },
      ])
    )

    await syncAdsForAccount('acc1')

    expect(g.supabase.callsTo('ad_campaigns', 'update')).toHaveLength(0)
    expect(g.supabase.callsTo('ad_campaigns', 'delete')).toHaveLength(0)
    const payload = g.supabase.callsTo('ad_campaigns', 'upsert')[0].payload as Array<{ source: string }>
    expect(payload.every((row) => row.source === 'meta_sync')).toBe(true)
  })

  it('spend não numérico vira 0 em vez de NaN', async () => {
    vi.mocked(fetch).mockResolvedValue(
      insights([
        {
          campaign_id: 'c-1',
          campaign_name: 'X',
          date_start: '2026-09-10',
          date_stop: '2026-09-10',
          spend: 'indisponível',
          impressions: '2000',
          clicks: '80',
        },
      ])
    )

    await syncAdsForAccount('acc1')

    const payload = g.supabase.callsTo('ad_campaigns', 'upsert')[0].payload as Array<{ spend: number }>
    expect(payload[0].spend).toBe(0)
  })

  it('sem token, não chama a Meta', async () => {
    g.token = null

    const result = await syncAdsForAccount('acc1')

    expect(result).toEqual({ synced: 0, skipped: 'no_token' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('token expirado marca a conexão como inválida', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'expired', code: 190 } }), { status: 401 })
    )

    const result = await syncAdsForAccount('acc1')

    expect(result.skipped).toBe('token_expired')
    expect(g.invalidated).toEqual(['acc1'])
  })
})
