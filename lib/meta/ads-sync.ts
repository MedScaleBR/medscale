import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getValidAdsToken, markAdsConnectionInvalid } from './ads-oauth'
import { graphFetch, MetaApiError } from './graph'

// A Meta reescreve números retroativamente por atribuição, então re-sincronizar
// a última semana é o que mantém o histórico honesto. O upsert é idempotente
// (índice parcial uq_ad_campaigns_meta_sync), logo reprocessar é barato.
export const SYNC_WINDOW_DAYS = 7

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
      const data = await graphFetch<{ data: InsightRow[] }>(`/${mapping.ad_account_id}/insights`, {
        token,
        params: {
          level: 'campaign',
          time_increment: '1',
          time_range: timeRange,
          fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
          limit: '500',
        },
      })
      rows = data.data ?? []
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
  }

  return { synced, skipped: null }
}
