import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncRevenueEntryToAppointmentStatus } from '@/lib/revenue/cycle'

const GRACE_MINUTES = 30 // considera no-show 30min após o horário agendado

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, 30min
// após o ponto. Marca como no_show consultas agendadas/confirmadas cujo horário
// já passou há mais de GRACE_MINUTES sem terem sido concluídas ou canceladas.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000).toISOString()

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id')
    .in('status', ['agendado', 'confirmado'])
    .lt('scheduled_at', cutoff)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!appointments || appointments.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  const ids = appointments.map((a) => a.id)
  const { error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .in('id', ids)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Ciclo de receita: entradas previstas dessas consultas viram 'cancelled'
  // (histórico financeiro é permanente — nunca se apaga o revenue_entry).
  await syncRevenueEntryToAppointmentStatus(supabase, ids, 'no_show')

  return NextResponse.json({ updated: ids.length })
}
