// Solicitação de agendamento de unidade com agenda externa: a Clara coletou os
// dados e a equipe confirma o horário no sistema da clínica. O resumo (dado de
// paciente) só existe em handoff_logs.summary, sob RLS — nunca em log técnico.
import { createAdminClient } from '@/lib/supabase/server'
import { broadcastToWorkspace } from '@/lib/realtime/broadcast'
import { trackHandoffTriggered } from '@/lib/analytics/posthog-server'
import type { ExternalRequestSummary } from '@/types/database'
import { EXTERNAL_REQUEST_REASON, formatExternalRequestLines } from './unit-settings'

export { EXTERNAL_REQUEST_REASON }

export const EXTERNAL_REQUEST_PUSH_TITLE = '📋 Solicitação de agendamento'

/** Corpo da push: o resumo em linhas, sem o título (que vai no `title`). */
export function externalRequestPushBody(summary: ExternalRequestSummary, unitName: string): string {
  return formatExternalRequestLines(summary, unitName).join('\n')
}

/**
 * Fora do horário de handoff: grava a solicitação como pendente (sem pausar o
 * bot) e avisa a equipe. Se a conversa já tem uma solicitação aberta, atualiza
 * o resumo dela em vez de abrir outra.
 */
export async function recordPendingExternalRequest(input: {
  accountId: string
  workspaceId: string
  unitName: string
  conversationId: string
  patientPhone: string
  handoffNumber: string | null
  summary: ExternalRequestSummary
}): Promise<void> {
  const { accountId, workspaceId, unitName, conversationId, patientPhone, handoffNumber, summary } = input
  const supabase = createAdminClient()

  const { data: open } = await supabase
    .from('handoff_logs')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('trigger_reason', EXTERNAL_REQUEST_REASON)
    .is('resolved_at', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = open
    ? await supabase.from('handoff_logs').update({ summary, workspace_id: workspaceId }).eq('id', open.id)
    : await supabase.from('handoff_logs').insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        patient_phone: patientPhone,
        trigger_reason: EXTERNAL_REQUEST_REASON,
        handoff_to: handoffNumber,
        summary,
      })
  if (error) console.error(`[external-request] gravação falhou workspace=${workspaceId} conversation=${conversationId}`)

  // A conversa passa a aparecer no /bot da unidade que vai confirmar.
  await supabase.from('conversations').update({ workspace_id: workspaceId }).eq('id', conversationId)

  try {
    const { sendHandoffPush } = await import('@/lib/push/send')
    await Promise.all([
      sendHandoffPush(workspaceId, {
        title: EXTERNAL_REQUEST_PUSH_TITLE,
        body: externalRequestPushBody(summary, unitName),
        url: `/bot?c=${conversationId}`,
      }),
      broadcastToWorkspace(workspaceId, 'handoff_message', {
        conversationId,
        patientName: summary.full_name ?? 'Paciente',
      }),
    ])
  } catch {
    console.error(`[external-request] push falhou workspace=${workspaceId}`)
  }

  await trackHandoffTriggered(accountId, {
    workspace_id: workspaceId,
    account_id: accountId,
    trigger_reason: EXTERNAL_REQUEST_REASON,
    handoff_available: false,
  })
}

/**
 * Dentro do horário, antes do executeHandoff: solicitações abertas antigas da
 * mesma conversa são substituídas pela nova (evita duas pendências iguais).
 */
export async function closeSupersededExternalRequests(conversationId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('handoff_logs')
    .update({ resolved_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('trigger_reason', EXTERNAL_REQUEST_REASON)
    .is('resolved_at', null)
}
