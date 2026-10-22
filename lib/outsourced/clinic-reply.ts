import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import {
  PENDING_EXTERNAL_STATUS,
  type ClinicConfirmationClassification,
  type Database,
} from '@/types/database'
import { matchClinicSender, type ClinicSenderMatch } from '@/lib/outsourced/config'
import { classifyUnparsedReply, parseClinicConfirmation, pickPendingMatch } from '@/lib/outsourced/parser'
import { confirmOutsourcedAppointment } from '@/lib/outsourced/confirm'
import { notifyOutsourcedIssue } from '@/lib/outsourced/notify'

export interface ClinicInboundMessage {
  id: string
  type: string
  text?: { body?: string }
}

/** Descobre se o remetente é o WhatsApp de clínica parceira de alguma unidade terceirizada da account. */
export async function resolveClinicSender(
  supabase: SupabaseClient<Database>,
  accountId: string,
  senderPhone: string
): Promise<ClinicSenderMatch> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, is_outsourced, external_clinic_phone')
    .eq('account_id', accountId)
    .eq('is_outsourced', true)
    .not('external_clinic_phone', 'is', null)

  if (error) throw new Error(`busca de unidades terceirizadas falhou account=${accountId}`)
  return matchClinicSender(data ?? [], senderPhone)
}

// Resposta da clínica parceira. Nunca vira paciente/conversa/mensagem e nunca
// é respondida: só confirma quando o template casa com exatamente 1 consulta
// pendente da unidade; qualquer outro caso vai para a equipe.
// LGPD: o texto fica só em clinic_confirmations/handoff_logs — o log leva
// apenas ids, classificação e contagem.
export async function processClinicReplyMessage(input: {
  accountId: string
  workspaceId: string
  message: ClinicInboundMessage
}): Promise<void> {
  const { accountId, workspaceId, message } = input
  const supabase = createAdminClient()
  const isText = message.type === 'text'
  const body = isText ? (message.text?.body ?? '') : ''
  const rawText = isText ? body : `[${message.type} recebido]`

  // Registro primeiro: whatsapp_id é único, então a reentrega da Meta para aqui.
  const { data: logRow, error: logError } = await supabase
    .from('clinic_confirmations')
    .insert({
      account_id: accountId,
      workspace_id: workspaceId,
      direction: 'inbound',
      raw_text: rawText,
      whatsapp_id: message.id,
    })
    .select('id')
    .single()

  if (logError?.code === '23505') return
  if (logError) console.error(`[outsourced] clinic_confirmations inbound falhou workspace=${workspaceId}`)

  let classification: ClinicConfirmationClassification = 'ambiguo'
  let candidates = 0
  let appointmentId: string | null = null

  // Mídia (áudio, imagem…) não dá para interpretar: fica ambíguo.
  const parsed = isText ? parseClinicConfirmation(body) : null
  if (isText && !parsed) {
    classification = classifyUnparsedReply(body)
  } else if (parsed) {
    const { data: pending, error } = await supabase
      .from('appointments')
      .select('id, patient_name')
      .eq('workspace_id', workspaceId)
      .eq('status', PENDING_EXTERNAL_STATUS)
      .eq('scheduled_at', parsed.scheduledAt.toISOString())

    if (error) console.error(`[outsourced] busca de pendentes falhou workspace=${workspaceId}`)
    const list = error ? [] : (pending ?? [])
    candidates = list.length

    const matchId = pickPendingMatch(list, parsed.patientName)
    if (matchId) {
      appointmentId = matchId
      try {
        const res = await confirmOutsourcedAppointment(matchId)
        if (res.ok) classification = 'confirmacao'
      } catch {
        console.error(`[outsourced] confirmação falhou appointment=${matchId}`)
      }
    }
  }

  console.log(`[outsourced] reply workspace=${workspaceId} classification=${classification} candidates=${candidates}`)

  if (logRow) {
    const update =
      classification === 'confirmacao' ? { appointment_id: appointmentId, classification } : { classification }
    const { error } = await supabase.from('clinic_confirmations').update(update).eq('id', logRow.id)
    if (error) console.error(`[outsourced] classificação da resposta falhou workspace=${workspaceId}`)
  }

  if (classification === 'confirmacao') return

  await notifyOutsourcedIssue({
    accountId,
    workspaceId,
    appointmentId,
    reason: classification === 'negacao' ? 'clinica_externa_negacao' : 'clinica_externa_ambiguo',
    // Mídia não tem texto para a equipe ler — o aviso vai sem.
    rawText: isText ? body : null,
  })
}
