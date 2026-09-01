import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { reconcileAccountCalendars } from '@/lib/google/reconcile'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, aos
// 50min — antes do reminders (:00) e do noshow (:30) do ciclo seguinte, pra
// ambos lerem um espelho Supabase atualizado mesmo que ninguém abra /agenda.
// Janela: de 3h atrás (cobre a folga do noshow) até 14 dias à frente — o
// bastante pra pegar um cancelamento/edição feita direto no Google antes do
// lembrete de 24h ou da checagem de no-show agirem sobre dado velho, sem
// escalar demais as chamadas à Calendar API por workspace por hora.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const { data: tokens, error } = await supabase.from('google_tokens').select('account_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!tokens || tokens.length === 0) return NextResponse.json({ reconciled: 0 })

  const now = new Date()
  const from = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  let reconciled = 0
  const errors: string[] = []

  for (const { account_id } of tokens) {
    try {
      await reconcileAccountCalendars(account_id, from, to)
      reconciled += 1
    } catch (err) {
      errors.push(`${account_id}: ${String(err)}`)
      console.error(`reconcile-calendar cron: account ${account_id} falhou`, err)
    }
  }

  return NextResponse.json({ reconciled, total: tokens.length, errors })
}
