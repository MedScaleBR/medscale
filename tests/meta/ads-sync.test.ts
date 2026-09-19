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

/** Resposta paginada: `after` não-nulo significa que ainda há página adiante. */
const page = (rows: unknown[], after: string | null) =>
  new Response(
    JSON.stringify({
      data: rows,
      paging: after ? { cursors: { after }, next: 'https://graph.facebook.com/next' } : {},
    }),
    { status: 200 }
  )

const row = (campaignId: string, date: string) => ({
  campaign_id: campaignId,
  campaign_name: campaignId,
  date_start: date,
  date_stop: date,
  spend: '10',
  impressions: '100',
  clicks: '5',
  actions: [{ action_type: 'lead', value: '1' }],
})

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

  it('segue o cursor e grava as linhas de todas as páginas', async () => {
    // Uma janela longa com várias campanhas passa das 500 linhas por resposta.
    // Sem seguir o cursor, as páginas seguintes somem sem erro nenhum.
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row('c-1', '2026-09-10')], 'cursor-2'))
      .mockResolvedValueOnce(page([row('c-2', '2026-09-11')], null))

    const result = await syncAdsForAccount('acc1')

    expect(result).toEqual({ synced: 2, skipped: null })
    // Duas páginas em level=campaign; a terceira chamada é o mapa de anúncios,
    // que roda uma vez por conta e não pagina.
    const campaignCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => new URL(c[0] as string).searchParams.get('level') === 'campaign')
    expect(campaignCalls).toHaveLength(2)
    expect(new URL(campaignCalls[1][0] as string).searchParams.get('after')).toBe('cursor-2')
  })

  it('respeita a janela de dias pedida no time_range', async () => {
    vi.mocked(fetch).mockResolvedValue(page([row('c-1', '2026-09-10')], null))

    await syncAdsForAccount('acc1', { days: 90 })

    const timeRange = JSON.parse(
      new URL(vi.mocked(fetch).mock.calls[0][0] as string).searchParams.get('time_range') ?? '{}'
    )
    const spanDays = Math.round(
      (Date.parse(timeRange.until) - Date.parse(timeRange.since)) / 86_400_000
    )
    expect(spanDays).toBe(90)
  })
})

// O `referral` do WhatsApp traz o ID do ANÚNCIO; `ad_campaigns` guarda o ID da
// CAMPANHA. Sem este mapa as duas metades da atribuição nunca se encontram.
describe('syncAdsForAccount — mapa anúncio -> campanha', () => {
  it('grava o mapa anuncio -> campanha junto do sync', async () => {
    vi.mocked(fetch)
      // 1ª chamada: insights por campanha (o que já existia).
      .mockResolvedValueOnce(page([row('c1', '2026-09-17')], null))
      // 2ª chamada: insights por anúncio, só para o mapa.
      .mockResolvedValueOnce(insights([{ ad_id: 'a1', ad_name: 'Criativo A', adset_name: 'Conjunto A', campaign_id: 'c1' }]))

    await syncAdsForAccount('acc1', { days: 7 })

    const upsert = g.supabase.callsTo('meta_ad_map', 'upsert')[0]
    expect(upsert.payload).toMatchObject([
      { account_id: 'acc1', ad_id: 'a1', campaign_id: 'c1', ad_name: 'Criativo A', adset_name: 'Conjunto A' },
    ])
    expect((upsert.options as { onConflict?: string })?.onConflict).toBe('account_id,ad_id')
  })

  it('pede o nível de anúncio sem time_increment, uma linha por anúncio no período', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row('c1', '2026-09-17')], null))
      .mockResolvedValueOnce(insights([{ ad_id: 'a1', campaign_id: 'c1' }]))

    await syncAdsForAccount('acc1', { days: 7 })

    const url = new URL(vi.mocked(fetch).mock.calls[1][0] as string)
    expect(url.searchParams.get('level')).toBe('ad')
    expect(url.searchParams.get('time_increment')).toBeNull()
  })

  it('descarta linha de anúncio sem ad_id ou sem campaign_id', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row('c1', '2026-09-17')], null))
      .mockResolvedValueOnce(insights([{ ad_id: 'a1', campaign_id: 'c1' }, { ad_id: 'a2' }, { campaign_id: 'c1' }]))

    await syncAdsForAccount('acc1', { days: 7 })

    expect(g.supabase.callsTo('meta_ad_map', 'upsert')[0].payload).toHaveLength(1)
  })

  // O mapa é acessório: se ele falhar, os números de gasto/cliques que já foram
  // gravados continuam valendo. Derrubar o sync inteiro por causa dele seria pior.
  it('não derruba o sync quando o nível de anúncio falha', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row('c1', '2026-09-17')], null))
      .mockRejectedValueOnce(new Error('meta fora do ar'))

    const result = await syncAdsForAccount('acc1', { days: 7 })

    expect(result).toEqual({ synced: 1, skipped: null })
    expect(g.supabase.callsTo('meta_ad_map', 'upsert')).toHaveLength(0)
  })
})
