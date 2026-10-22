import { createAdminClient } from '@/lib/supabase/server'
import { PENDING_EXTERNAL_STATUS, type Database } from '@/types/database'
import { decryptToken } from '@/lib/crypto'
import { sendTemplateMessage, sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { markEventConfirmed } from '@/lib/google/calendar'
import { applyAppointmentRevenue } from '@/lib/revenue/cycle'
import { confirmedMessage } from '@/lib/outsourced/messages'
import { TEMPLATE_CONSULTA_CONFIRMADA, buildConsultaConfirmadaParams } from '@/lib/outsourced/templates'

type Appointment = Database['public']['Tables']['appointments']['Row']
type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type ConfirmOutsourcedResult = { ok: true; appointmentId: string } | { ok: false; reason: 'not_pending' }

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

// A clínica parceira confirmou o horário (pelo webhook ou pelo painel): a
// consulta pendente vira confirmada e o paciente é avisado. Só o update
// condicional é obrigatório — receita, Google e aviso são best-effort e nunca
// desfazem o confirmado.
// LGPD: os logs daqui levam só ids.
export async function confirmOutsourcedAppointment(appointmentId: string): Promise<ConfirmOutsourcedResult> {
  const supabase = createAdminClient()

  // Condicional no status: se o paciente cancelou (ou outra confirmação chegou
  // antes), nada muda.
  const { data: appt, error } = await supabase
    .from('appointments')
    .update({ status: 'confirmado' })
    .eq('id', appointmentId)
    .eq('status', PENDING_EXTERNAL_STATUS)
    .select()
    .maybeSingle()

  if (error) throw new Error(`confirmação da consulta terceirizada falhou appointment=${appointmentId}`)
  if (!appt) return { ok: false, reason: 'not_pending' }

  // Previsão de receita nasce agora (pendente não gera).
  try {
    await applyAppointmentRevenue(supabase, {
      booking: {
        workspaceId: appt.workspace_id,
        accountId: appt.account_id,
        appointmentId: appt.id,
        patientId: appt.patient_id ?? null,
        procedureId: appt.procedure_id ?? null,
        procedureName: appt.procedure_name ?? null,
        amount: appt.price != null ? Number(appt.price) : null,
        scheduledAt: appt.scheduled_at,
        source: 'bot',
      },
      previousStatus: PENDING_EXTERNAL_STATUS,
      nextStatus: 'confirmado',
      healthPlan: appt.health_plan ?? null,
    })
  } catch {
    console.error(`[outsourced] receita da confirmação falhou appointment=${appt.id}`)
  }

  if (appt.gcal_event_id) {
    try {
      await markEventConfirmed(appt.workspace_id, appt.gcal_event_id)
    } catch {
      console.error(`[outsourced] gcal confirmar falhou appointment=${appt.id}`)
    }
  }

  try {
    await notifyPatient(supabase, appt)
  } catch {
    console.error(`[outsourced] aviso de confirmação ao paciente falhou appointment=${appt.id}`)
  }

  return { ok: true, appointmentId: appt.id }
}

async function notifyPatient(supabase: SupabaseAdmin, appt: Appointment): Promise<void> {
  const [{ data: unit }, { data: bot }, { data: conversation }] = await Promise.all([
    supabase.from('workspaces').select('name, address, city, state').eq('id', appt.workspace_id).single(),
    supabase.from('bot_config').select('phone_number_id, meta_token').eq('account_id', appt.account_id).maybeSingle(),
    supabase
      .from('conversations')
      .select('id')
      .eq('account_id', appt.account_id)
      .eq('patient_phone', appt.patient_phone)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!bot?.phone_number_id || !bot.meta_token) {
    console.error(`[outsourced] WhatsApp não conectado, paciente não avisado appointment=${appt.id}`)
    return
  }

  const unitName = unit?.name ?? 'Unidade'
  const address = [unit?.address, unit?.city, unit?.state].filter(Boolean).join(', ') || null
  const scheduledAt = new Date(appt.scheduled_at)
  const content = confirmedMessage({ scheduledAt, unitName, address })

  // Texto livre só dentro da janela de 24h aberta pelo paciente; fora dela, template.
  let windowOpen = false
  if (conversation) {
    const { data: lastUser } = await supabase
      .from('messages')
      .select('sent_at')
      .eq('conversation_id', conversation.id)
      .eq('role', 'user')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    windowOpen = !!lastUser && Date.now() - new Date(lastUser.sent_at).getTime() < SERVICE_WINDOW_MS
  }

  const token = decryptToken(bot.meta_token)
  if (windowOpen) {
    await sendWhatsAppMessage({ to: appt.patient_phone, message: content, phoneNumberId: bot.phone_number_id, token })
  } else {
    await sendTemplateMessage({
      to: appt.patient_phone,
      phoneNumberId: bot.phone_number_id,
      token,
      templateName: TEMPLATE_CONSULTA_CONFIRMADA,
      parameters: buildConsultaConfirmadaParams({ patientName: appt.patient_name, scheduledAt, unitName }),
    })
  }

  if (conversation) {
    const { error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversation.id, role: 'assistant', content })
    if (error) console.error(`[outsourced] histórico da confirmação falhou appointment=${appt.id}`)
  }
}
