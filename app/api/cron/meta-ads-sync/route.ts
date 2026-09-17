import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { syncAdsForAccount } from '@/lib/meta/ads-sync'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por dia.
//
// syncAdsForAccount já isola falhas por conta de anúncio (uma ad account
// quebrada não aborta as outras da mesma account); o try/catch aqui cobre o
// nível acima — um erro inesperado numa account inteira (ex: falha de rede na
// query de mapeamentos) não pode interromper o sync das accounts seguintes.
// `skipped` também é contado por tipo em vez de descartado: sem isso, um
// operador olhando a resposta não teria como distinguir "nada pra sincronizar"
// de "toda conexão está com token morto".
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: connections } = await supabase
    .from('meta_ads_connections')
    .select('account_id')
    .eq('is_valid', true)

  let synced = 0
  let noToken = 0
  let tokenExpired = 0

  for (const conn of connections ?? []) {
    try {
      const result = await syncAdsForAccount(conn.account_id)
      synced += result.synced
      if (result.skipped === 'no_token') noToken += 1
      else if (result.skipped === 'token_expired') tokenExpired += 1
    } catch (err) {
      Sentry.captureException(err, {
        tags: { area: 'meta', flow: 'ads_sync_cron' },
        extra: { accountId: conn.account_id },
      })
    }
  }

  return NextResponse.json({
    accounts: connections?.length ?? 0,
    synced,
    skipped: { no_token: noToken, token_expired: tokenExpired },
  })
}
