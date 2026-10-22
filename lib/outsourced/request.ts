import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'
import { sendTemplateMessage } from '@/lib/whatsapp/send'
import { isGoogleConnected } from '@/lib/google/auth'
import { createEvent, deleteEvent } from '@/lib/google/calendar'
import { trackAppointmentBookedByBot } from '@/lib/analytics/posthog-server'
import { notifyOutsourcedIssue } from '@/lib/outsourced/notify'
import {
  TEMPLATE_SOLICITACAO_AGENDAMENTO,
  buildSolicitacaoParams,
  renderSolicitacaoText,
} from '@/lib/outsourced/templates'

export interface ExternalRequestInput {
  supabase: SupabaseClient<Database>
  accountId: string
  accountName: string
  unit: { id: string; name: string; externalClinicPhone: string }
  patient: { id: string; fullName: string; birthDate: string } // birthDate AAAA-MM-DD
  patientPhone: string
  conversationId: string
  scheduledAt: Date
  durationMin: number
  insurer: { id: string; name: string } | null // null = particular
  procedure: { id: string; name: string; price: number } | null
  /** Consulta que a Clara cancela na mesma resposta (remarcação) — ignorada na checagem de duplicidade. */
  replacingAppointmentId: string | null
  phoneNumberId: string | null
  metaToken: string | null // já descriptografado
}

export type ExternalRequestResult =
  | { kind: 'requested'; appointmentId: string }
  | { kind: 'already_pending' }
  | { kind: 'send_failed'; appointmentId: string }
  | { kind: 'insert_failed' }

// Unidade terceirizada: em vez de agendar direto, a Clara cria a consulta como
// pendente e pede o horário à clínica parceira pelo template da Meta. A
// confirmação chega depois, pelo webhook (lib/outsourced/clinic-reply).
// LGPD: os logs daqui levam só ids — nunca nome, nascimento, convênio ou telefone.
export async function requestExternalConfirmation(input: ExternalRequestInput): Promise<ExternalRequestResult> {
  const { supabase, accountId, unit, patient, scheduledAt, durationMin, insurer, procedure } = input

  // 1. Uma solicitação em andamento por paciente e unidade.
  let pendingQuery = supabase
    .from('appointments')
    .select('id')
    .eq('workspace_id', unit.id)
    .eq('patient_id', patient.id)
    .eq('status', PENDING_EXTERNAL_STATUS)
  if (input.replacingAppointmentId) pendingQuery = pendingQuery.neq('id', input.replacingAppointmentId)
  const { data: existing, error: pendingError } = await pendingQuery.limit(1).maybeSingle()

  if (pendingError) {
    console.error(`[outsourced] checagem de pendente falhou workspace=${unit.id} patient=${patient.id}`)
    return insertFailed(input)
  }
  if (existing) return { kind: 'already_pending' }

  // 2. Consulta pendente. Sem receita prevista até a clínica confirmar.
  const { data: appt } = await supabase
    .from('appointments')
    .insert({
      workspace_id: unit.id,
      account_id: accountId,
      patient_id: patient.id,
      patient_name: patient.fullName,
      patient_phone: input.patientPhone,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: durationMin,
      source: 'bot',
      status: PENDING_EXTERNAL_STATUS,
      external_requested_at: new Date().toISOString(),
      procedure_id: procedure?.id ?? null,
      procedure_name: procedure?.name ?? null,
      price: procedure?.price ?? null,
      ...(insurer ? {
        billing_type: 'convenio' as const,
        insurer_id: insurer.id,
        health_plan: insurer.name,
      } : {}),
    })
    .select()
    .single()

  if (!appt) {
    console.error(`[outsourced] insert do pendente falhou workspace=${unit.id} patient=${patient.id}`)
    return insertFailed(input)
  }

  // 3. Conversa passa a apontar para a consulta (mesmo efeito do agendamento nativo).
  await supabase
    .from('conversations')
    .update({ appointment_id: appt.id, workspace_id: unit.id })
    .eq('id', input.conversationId)

  // 4. Evento provisório no Google — best-effort, não segura a solicitação.
  let gcalEventId: string | null = null
  try {
    const { connected, email } = await isGoogleConnected(accountId)
    if (connected && email) {
      const gcalEvent = await createEvent({
        workspaceId: unit.id,
        patientName: appt.patient_name,
        patientPhone: appt.patient_phone,
        appointmentType: appt.type,
        startTime: scheduledAt,
        durationMin,
        workspaceName: unit.name,
        doctorEmail: email,
        pending: true,
      })
      if (gcalEvent.id) {
        gcalEventId = gcalEvent.id
        await supabase.from('appointments').update({ gcal_event_id: gcalEvent.id }).eq('id', appt.id)
      }
    }
  } catch {
    console.error(`[outsourced] gcal pendente falhou appointment=${appt.id}`)
  }

  // 5. Template para a clínica parceira — o único envio para esse número.
  const params = buildSolicitacaoParams({
    scheduledAt,
    patientName: patient.fullName,
    insuranceLabel: insurer?.name ?? 'Particular',
    birthDate: patient.birthDate,
    patientPhone: input.patientPhone,
  })

  let whatsappId: string | null = null
  try {
    if (!input.phoneNumberId || !input.metaToken) throw new Error('WhatsApp não conectado')
    const res = await sendTemplateMessage({
      to: unit.externalClinicPhone,
      phoneNumberId: input.phoneNumberId,
      token: input.metaToken,
      templateName: TEMPLATE_SOLICITACAO_AGENDAMENTO,
      parameters: params,
    })
    whatsappId = res.messages?.[0]?.id ?? null
  } catch {
    console.error(`[outsourced] envio da solicitação falhou appointment=${appt.id} workspace=${unit.id}`)
    const { error: cancelError } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', appt.id)
    if (cancelError) console.error(`[outsourced] cancel after send failure failed appointment=${appt.id}`)
    if (gcalEventId) {
      try {
        await deleteEvent(unit.id, gcalEventId)
      } catch {
        console.error(`[outsourced] gcal delete falhou appointment=${appt.id}`)
      }
    }
    await notifyOutsourcedIssue({
      accountId,
      workspaceId: unit.id,
      appointmentId: appt.id,
      reason: 'clinica_externa_falha_envio',
    })
    return { kind: 'send_failed', appointmentId: appt.id }
  }

  // 6. Pedido saiu: lista de espera e analytics, como no agendamento nativo.
  await supabase
    .from('waitlist')
    .update({ status: 'scheduled' })
    .eq('workspace_id', unit.id)
    .eq('patient_id', patient.id)
    .eq('status', 'waiting')

  await trackAppointmentBookedByBot(accountId, {
    workspace_id: unit.id,
    account_id: accountId,
    slot_datetime: scheduledAt.toISOString(),
  })

  // 7. Histórico do que foi enviado. Falha aqui só loga — o pedido já saiu.
  const { error: logError } = await supabase.from('clinic_confirmations').insert({
    account_id: accountId,
    workspace_id: unit.id,
    appointment_id: appt.id,
    direction: 'outbound',
    raw_text: renderSolicitacaoText(params),
    whatsapp_id: whatsappId,
  })
  if (logError) console.error(`[outsourced] clinic_confirmations outbound falhou appointment=${appt.id}`)

  return { kind: 'requested', appointmentId: appt.id }
}

// O paciente ouve "a equipe vai te retornar" — então a equipe precisa saber.
async function insertFailed(input: ExternalRequestInput): Promise<ExternalRequestResult> {
  await notifyOutsourcedIssue({
    accountId: input.accountId,
    workspaceId: input.unit.id,
    appointmentId: null,
    reason: 'clinica_externa_falha_envio',
  })
  return { kind: 'insert_failed' }
}
