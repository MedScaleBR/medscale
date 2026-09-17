import { createAdminClient } from '@/lib/supabase/server'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { graphFetch, GRAPH_VERSION } from './graph'

// OAuth do Facebook para leitura de métricas de anúncio. Segue o padrão do
// Google (lib/google/auth.ts): conexão única por account, state = accountId,
// token cifrado no banco.

export const ADS_SCOPES = ['ads_read', 'business_management'] as const

export function isAdsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_META_APP_ID && process.env.META_APP_SECRET)
}

function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/meta/ads/callback`
}

export function getAdsAuthUrl(accountId: string): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', process.env.NEXT_PUBLIC_META_APP_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', ADS_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', accountId)
  return url.toString()
}

export async function exchangeAdsCodeAndSave(
  code: string,
  accountId: string,
  connectedByUserId: string
): Promise<void> {
  const short = await graphFetch<{ access_token: string }>('/oauth/access_token', {
    params: {
      client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      redirect_uri: redirectUri(),
      code,
    },
  })

  // Token curto dura horas; o longo dura ~60 dias e é o que viabiliza o cron.
  const long = await graphFetch<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.NEXT_PUBLIC_META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      fb_exchange_token: short.access_token,
    },
  })

  const me = await graphFetch<{ id: string }>('/me', { token: long.access_token, params: { fields: 'id' } })

  const supabase = createAdminClient()
  const { error } = await supabase.from('meta_ads_connections').upsert(
    {
      account_id: accountId,
      fb_user_id: me.id,
      access_token: encryptToken(long.access_token),
      token_expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      scopes: [...ADS_SCOPES],
      connected_by: connectedByUserId,
      is_valid: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' }
  )
  if (error) throw new Error(error.message)
}

export async function getValidAdsToken(accountId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('meta_ads_connections')
    .select('access_token, is_valid, token_expires_at')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!data || !data.is_valid) return null
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) return null
  try {
    return decryptToken(data.access_token)
  } catch {
    return null
  }
}

/** Chamado quando a Meta responde 190: a UI passa a pedir reconexão. */
export async function markAdsConnectionInvalid(accountId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('meta_ads_connections')
    .update({ is_valid: false, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
}
