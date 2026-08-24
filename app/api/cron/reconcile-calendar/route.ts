import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { reconcileCalendar } from '@/lib/google/reconcile'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, aos
// 50min — antes do reminders (:00) e do noshow (:30) do ciclo seguinte, pra
// ambos lerem um espelho Supabase atualizado mesmo que ninguém abra /agenda.
// Janela: de 3h atrás (cobre a folga do noshow) até 14 dias à frente — o
// bastante pra pegar um cancelamento/edição feita direto no Google antes do
// lembrete de 24h ou da checagem de no-show agirem sobre dado velho, sem
// escalar demais as chamadas à Calendar API por workspace por hora.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: tokens, error } = await supabase.from('google_tokens').select('workspace_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!tokens || tokens.length === 0) return NextResponse.json({ reconciled: 0 })

  const now = new Date()
  const from = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  let reconciled = 0
  const errors: string[] = []

  for (const { workspace_id } of tokens) {
    try {
      await reconcileCalendar(workspace_id, from, to)
      reconciled += 1
    } catch (err) {
      errors.push(`${workspace_id}: ${String(err)}`)
      console.error(`reconcile-calendar cron: workspace ${workspace_id} falhou`, err)
    }
  }

  return NextResponse.json({ reconciled, total: tokens.length, errors })
}
