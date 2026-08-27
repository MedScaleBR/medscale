import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendReminderTemplate } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, no
// ponto. Envia lembrete de consulta a pacientes com consulta entre 23h e 25h no
// futuro e ainda sem lembrete enviado.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, workspace_id, patient_name, patient_phone, scheduled_at')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .eq('reminder_sent', false)
    .in('status', ['agendado', 'confirmado'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!appointments || appointments.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const workspaceIds = [...new Set(appointments.map((a) => a.workspace_id))]
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, phone_number_id, meta_token, address, city, state')
    .in('id', workspaceIds)

  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]))

  let sent = 0
  const errors: string[] = []

  for (const appt of appointments) {
    const workspace = workspaceById.get(appt.workspace_id)
    if (!workspace?.phone_number_id || !workspace?.meta_token) continue

    const scheduledAt = new Date(appt.scheduled_at)
    const address =
      [workspace.address, workspace.city, workspace.state].filter(Boolean).join(', ') ||
      workspace.name

    try {
      await sendReminderTemplate({
        to: appt.patient_phone,
        phoneNumberId: workspace.phone_number_id,
        token: decryptToken(workspace.meta_token),
        patientName: appt.patient_name,
        appointmentDate: scheduledAt.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
        appointmentTime: scheduledAt.toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
        }),
        address,
      })
      await supabase.from('appointments').update({ reminder_sent: true }).eq('id', appt.id)
      sent += 1
    } catch (err) {
      errors.push(`${appt.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ sent, total: appointments.length, errors })
}
