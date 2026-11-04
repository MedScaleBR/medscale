// Aviso por e-mail da solicitação de agendamento (unidade com agenda externa).
// Vai só para os endereços cadastrados pela MedScale na unidade, com o resumo
// e a foto da carteirinha em anexo. Falha aqui nunca desfaz o handoff.
//
// LGPD: log só com ids e status. Nada de nome, telefone, e-mail ou imagem.
import { createAdminClient } from '@/lib/supabase/server'
import { isMailerConfigured, sendMail, type MailAttachment } from '@/lib/email/mailer'
import { buildSchedulingRequestEmail } from '@/lib/email/templates/scheduling-request'
import { INSURANCE_CARD_BUCKET } from '@/lib/bot/insurance-card'
import { EXTERNAL_REQUEST_REASON, formatExternalRequestLines } from '@/lib/bot/unit-settings'
import type { ExternalRequestSummary } from '@/types/database'

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }

export async function sendExternalRequestEmail(input: {
  conversationId: string
  workspaceId: string
  unitName: string
  summary: ExternalRequestSummary
}): Promise<void> {
  const { conversationId, workspaceId, unitName, summary } = input
  if (!isMailerConfigured()) return

  const supabase = createAdminClient()
  // Sem a coluna (migration pendente) ou sem e-mails: pula em silêncio.
  const { data: unit, error: unitError } = await supabase
    .from('workspaces')
    .select('notification_emails')
    .eq('id', workspaceId)
    .maybeSingle()
  const recipients = unitError ? [] : (unit?.notification_emails ?? [])
  if (recipients.length === 0) return

  // A solicitação que acabou de ser gravada (handoff ou pendente).
  const { data: log } = await supabase
    .from('handoff_logs')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('trigger_reason', EXTERNAL_REQUEST_REASON)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const logId = log?.id ?? 'desconhecido'

  try {
    const attachments: MailAttachment[] = []
    if (summary.insurance_card_photo === 'sent') {
      const { data: card } = await supabase
        .from('conversation_attachments')
        .select('storage_path, mime_type')
        .eq('conversation_id', conversationId)
        .eq('kind', 'insurance_card')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (card) {
        const { data: file, error: fileError } = await supabase.storage.from(INSURANCE_CARD_BUCKET).download(card.storage_path)
        if (!fileError && file) {
          attachments.push({
            filename: `carteirinha.${EXT[card.mime_type] ?? 'bin'}`,
            content: Buffer.from(await file.arrayBuffer()),
            contentType: card.mime_type,
          })
        } else {
          console.warn(`[email] attachment_missing handoff_log_id=${logId}`)
        }
      }
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const email = buildSchedulingRequestEmail({
      patientName: summary.full_name ?? null,
      unitName,
      lines: formatExternalRequestLines(summary, unitName),
      conversationUrl: `${appUrl}/bot?c=${conversationId}`,
      hasCardPhoto: attachments.length > 0,
    })

    const result = await sendMail({ to: recipients, ...email, attachments })
    if (!result.sent) {
      console.error(`[email] email_failed handoff_log_id=${logId}`)
      return
    }
    if (log) await supabase.from('handoff_logs').update({ email_sent_at: new Date().toISOString() }).eq('id', log.id)
    console.log(`[email] email_sent handoff_log_id=${logId} recipients=${recipients.length} attachments=${attachments.length}`)
  } catch {
    console.error(`[email] email_failed handoff_log_id=${logId}`)
  }
}
