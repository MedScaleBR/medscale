import { createAdminClient } from '@/lib/supabase/server'
import type { HandoffTriggerReason } from '@/types/database'

// Problemas do fluxo terceirizado que a equipe precisa resolver. Não pausa a
// conversa do paciente (não toca em `conversations`): só deixa rastro em
// handoff_logs e avisa por push.
export type OutsourcedIssueReason = Extract<
  HandoffTriggerReason,
  | 'clinica_externa_ambiguo'
  | 'clinica_externa_negacao'
  | 'clinica_externa_timeout'
  | 'cancelamento_terceirizado'
  | 'clinica_externa_falha_envio'
  | 'clinica_externa_config'
>

const PUSH_BODY: Record<OutsourcedIssueReason, string> = {
  clinica_externa_ambiguo: 'resposta da clínica parceira precisa de revisão',
  clinica_externa_negacao: 'resposta da clínica parceira precisa de revisão',
  clinica_externa_timeout: 'clínica parceira ainda não confirmou uma solicitação',
  cancelamento_terceirizado: 'paciente cancelou — avise a clínica parceira',
  clinica_externa_falha_envio: 'não foi possível enviar a solicitação à clínica parceira',
  clinica_externa_config: 'o mesmo WhatsApp de clínica parceira está em mais de uma unidade',
}

export async function notifyOutsourcedIssue(input: {
  accountId: string
  workspaceId: string
  appointmentId?: string | null
  reason: OutsourcedIssueReason
  rawText?: string | null
}): Promise<void> {
  const { workspaceId, appointmentId, reason, rawText } = input
  // LGPD: só ids e o motivo vão para o log; rawText fica apenas em handoff_logs.
  console.log(`[outsourced] notify reason=${reason} workspace=${workspaceId} appointment=${appointmentId ?? '-'}`)

  let workspaceName = 'Unidade'
  try {
    const supabase = createAdminClient()

    const { data: ws } = await supabase.from('workspaces').select('name').eq('id', workspaceId).single()
    if (ws?.name) workspaceName = ws.name

    let patientPhone: string | null = null
    if (appointmentId) {
      const { data: appt } = await supabase
        .from('appointments')
        .select('patient_phone')
        .eq('id', appointmentId)
        .single()
      patientPhone = appt?.patient_phone ?? null
    }

    const { error } = await supabase.from('handoff_logs').insert({
      workspace_id: workspaceId,
      conversation_id: null,
      patient_phone: patientPhone,
      trigger_reason: reason,
      handoff_to: null,
      flagged_content: rawText ?? null,
    })
    if (error) console.error(`[outsourced] notify handoff_logs falhou reason=${reason} workspace=${workspaceId}`)
  } catch {
    console.error(`[outsourced] notify leitura/log falhou reason=${reason} workspace=${workspaceId}`)
  }

  try {
    const { sendHandoffPush } = await import('@/lib/push/send')
    await sendHandoffPush(workspaceId, {
      title: '⚠️ Clínica parceira',
      body: `${workspaceName}: ${PUSH_BODY[reason]}`,
      url: '/agenda',
    })
  } catch {
    console.error(`[outsourced] notify push falhou reason=${reason} workspace=${workspaceId}`)
  }
}
