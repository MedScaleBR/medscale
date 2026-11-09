import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendConversionEvent } from '@/lib/meta/conversions'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) a cada 30 minutos.
// Reenvia LeadSubmitted que falharam (Meta fora, token sem permissão...).
// Desiste depois de 5 tentativas ou 7 dias: fora dessa janela a Meta não usa o
// evento para otimizar a campanha.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 7 * 86_400_000
const BATCH = 200

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: events, error } = await supabase
    .from('meta_conversion_events')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .gte('event_time', new Date(Date.now() - WINDOW_MS).toISOString())
    .order('event_time')
    .limit(BATCH)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sent = 0
  let failed = 0
  for (const event of events ?? []) {
    // Em sequência: o volume é pequeno e evita estourar o rate limit da Meta.
    if ((await sendConversionEvent(event.id, supabase)) === 'sent') sent += 1
    else failed += 1
  }

  return NextResponse.json({ processed: sent + failed, sent, failed })
}
