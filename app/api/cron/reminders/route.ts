import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendReminderTemplate } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, no
// ponto. Envia lembrete de consulta a pacientes com consulta entre 23h e 25h no
// futuro e ainda sem lembrete enviado. O número WhatsApp é único por account
// (bot_config); o endereço vem da unidade da consulta (workspaces).
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, workspace_id, account_id, patient_name, patient_phone, scheduled_at')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .eq('reminder_sent', false)
    .in('status', ['agendado', 'confirmado'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!appointments || appointments.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const workspaceIds = [...new Set(appointments.map((a) => a.workspace_id))]
  const accountIds = [...new Set(appointments.map((a) => a.account_id))]

  const [{ data: workspaces }, { data: botConfigs }] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id, name, address, city, state, zip_code')
      .in('id', workspaceIds),
    supabase
      .from('bot_config')
      .select('account_id, phone_number_id, meta_token')
      .in('account_id', accountIds),
  ])

  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]))
  const connByAccount = new Map((botConfigs ?? []).map((c) => [c.account_id, c]))

  let sent = 0
  const errors: string[] = []

  for (const appt of appointments) {
    const workspace = workspaceById.get(appt.workspace_id)
    const conn = connByAccount.get(appt.account_id)
    if (!workspace || !conn?.phone_number_id || !conn?.meta_token) continue

    const scheduledAt = new Date(appt.scheduled_at)
    const structuredAddress = [workspace.address, workspace.city, workspace.state, workspace.zip_code]
      .filter(Boolean)
      .join(', ')

    // Endereço da unidade > cidade/UF > nome da unidade (a Meta rejeita param vazio).
    const address = structuredAddress || workspace.name

    try {
      await sendReminderTemplate({
        to: appt.patient_phone,
        phoneNumberId: conn.phone_number_id,
        token: decryptToken(conn.meta_token),
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
