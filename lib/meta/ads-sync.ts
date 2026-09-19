import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getValidAdsToken, markAdsConnectionInvalid } from './ads-oauth'
import { graphFetch, MetaApiError } from './graph'

// A Meta reescreve números retroativamente por atribuição, então re-sincronizar
// a última semana é o que mantém o histórico honesto. O upsert é idempotente
// (índice uq_ad_campaigns_meta_sync), logo reprocessar é barato.
export const SYNC_WINDOW_DAYS = 7

// As três janelas que o seletor da /trafego oferece. Lista fechada porque o
// valor vira chamada paga na Meta: a rota recusa qualquer coisa fora daqui.
export const SYNC_WINDOW_OPTIONS = [7, 30, 90] as const
export type SyncWindow = (typeof SYNC_WINDOW_OPTIONS)[number]

export function isSyncWindow(days: number): days is SyncWindow {
  return (SYNC_WINDOW_OPTIONS as readonly number[]).includes(days)
}

export const LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
]

interface InsightRow {
  campaign_id: string
  campaign_name?: string
  date_start: string
  date_stop: string
  spend?: string
  impressions?: string
  clicks?: string
  actions?: { action_type: string; value: string }[]
}

interface InsightsPage {
  data?: InsightRow[]
  paging?: { cursors?: { after?: string }; next?: string }
}

const PAGE_LIMIT = 500

// Trava de segurança: se a Meta devolvesse cursor pra sempre, o loop rodaria
// pra sempre. 20 páginas de 500 cobrem 10 mil linhas — muito além de qualquer
// janela que a UI oferece.
const MAX_PAGES = 20

// `time_increment: '1'` gera uma linha por campanha POR DIA, então 90 dias com
// meia dúzia de campanhas já passa de 500 e a Meta pagina. Ler só a primeira
// resposta perdia o resto em silêncio — sem erro, sem log, só dado faltando.
async function fetchAllInsights(
  adAccountId: string,
  token: string,
  timeRange: string
): Promise<InsightRow[]> {
  const rows: InsightRow[] = []
  let after: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await graphFetch<InsightsPage>(`/${adAccountId}/insights`, {
      token,
      params: {
        level: 'campaign',
        time_increment: '1',
        time_range: timeRange,
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
        limit: String(PAGE_LIMIT),
        ...(after ? { after } : {}),
      },
    })

    rows.push(...(data.data ?? []))

    // `cursors.after` vem mesmo na última página; é `next` que diz se há mais.
    after = data.paging?.next ? data.paging.cursors?.after : undefined
    if (!after) break
  }

  return rows
}

interface AdRow {
  ad_id?: string
  ad_name?: string
  adset_name?: string
  campaign_id?: string
}

/** Segunda passada no mesmo endpoint, agora em `level: 'ad'`. Só precisamos dos
 *  identificadores, então `time_increment` fica de fora: uma linha por anúncio
 *  no período inteiro, não uma por dia. */
async function fetchAdMap(
  adAccountId: string,
  token: string,
  timeRange: string
): Promise<AdRow[]> {
  const data = await graphFetch<{ data?: AdRow[] }>(`/${adAccountId}/insights`, {
    token,
    params: {
      level: 'ad',
      time_range: timeRange,
      fields: 'ad_id,ad_name,adset_name,campaign_id',
      limit: String(PAGE_LIMIT),
    },
  })
  return data.data ?? []
}

// Number() de string vazia/undefined/lixo não numérico vira NaN, que some em
// silêncio dentro de uma soma (NaN + n = NaN) e quebra a coluna not-null no
// upsert — por isso todo valor que vem da Meta como string passa por aqui.
function toNumber(value: string | undefined | null): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function extractLeads(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0
  return actions
    .filter((a) => LEAD_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + toNumber(a.value), 0)
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function syncAdsForAccount(
  accountId: string,
  opts: { days?: number } = {}
): Promise<{ synced: number; skipped: 'no_token' | 'token_expired' | null }> {
  const token = await getValidAdsToken(accountId)
  if (!token) return { synced: 0, skipped: 'no_token' }

  const supabase = createAdminClient()
  const { data: mappings } = await supabase
    .from('workspace_ad_accounts')
    .select('workspace_id, ad_account_id, account_id')
    .eq('account_id', accountId)

  if (!mappings?.length) return { synced: 0, skipped: null }

  const days = opts.days ?? SYNC_WINDOW_DAYS
  const timeRange = JSON.stringify({ since: isoDaysAgo(days), until: isoDaysAgo(0) })
  let synced = 0

  for (const mapping of mappings) {
    let rows: InsightRow[]
    try {
      rows = await fetchAllInsights(mapping.ad_account_id, token, timeRange)
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenExpired) {
        await markAdsConnectionInvalid(accountId)
        return { synced, skipped: 'token_expired' }
      }
      // Uma conta de anúncio quebrada não pode derrubar as outras.
      Sentry.captureException(err, { tags: { area: 'meta', flow: 'ads_sync' }, extra: { adAccount: mapping.ad_account_id } })
      continue
    }

    if (!rows.length) continue

    const payload = rows.map((row) => ({
      workspace_id: mapping.workspace_id,
      account_id: accountId,
      channel: 'facebook' as const,
      source: 'meta_sync' as const,
      external_campaign_id: row.campaign_id,
      campaign_name: row.campaign_name ?? null,
      period_start: row.date_start,
      period_end: row.date_stop,
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      leads: extractLeads(row.actions),
    }))

    const { error } = await supabase
      .from('ad_campaigns')
      .upsert(payload, { onConflict: 'workspace_id,external_campaign_id,period_start' })

    if (error) {
      Sentry.captureException(new Error(error.message), { tags: { area: 'meta', flow: 'ads_sync' } })
      continue
    }
    synced += payload.length

    // O mapa é acessório: gasto e cliques já foram gravados acima e continuam
    // valendo sem ele. Um erro aqui não pode derrubar o sync da conta.
    try {
      const ads = await fetchAdMap(mapping.ad_account_id, token, timeRange)
      const adPayload = ads
        .filter((ad) => ad.ad_id && ad.campaign_id)
        .map((ad) => ({
          account_id: accountId,
          ad_id: ad.ad_id!,
          campaign_id: ad.campaign_id!,
          ad_name: ad.ad_name ?? null,
          adset_name: ad.adset_name ?? null,
          synced_at: new Date().toISOString(),
        }))

      if (adPayload.length > 0) {
        const { error: mapError } = await supabase
          .from('meta_ad_map')
          .upsert(adPayload, { onConflict: 'account_id,ad_id' })
        if (mapError) throw new Error(mapError.message)
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { area: 'meta', flow: 'ads_sync_ad_map' },
        extra: { adAccount: mapping.ad_account_id },
      })
    }
  }

  return { synced, skipped: null }
}
