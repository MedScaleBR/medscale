import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotInboxClient, type ConversationWithMessages } from '@/components/bot/BotInboxClient'
import { isUnread, summarizeVisits } from '@/lib/bot/inbox'
import { formatExternalRequestLines } from '@/lib/bot/unit-settings'
import type { ExternalRequestView } from '@/components/bot/ExternalRequestCard'
import type { ExternalRequestSummary } from '@/types/database'

export default async function BotPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: conversations } = await supabase
    .from('conversations')
    .select(
      'id, patient_phone, patient_id, status, bot_paused, archived_at, started_at, patients(id, full_name, tags, notes), messages(id, role, content, sent_at)'
    )
    .eq('workspace_id', session.workspaceId)
    .order('started_at', { ascending: false })
    .limit(50)

  // Última/próxima consulta da barra de contexto: o vínculo é o telefone, não
  // patient_id — conversa de paciente ainda não cadastrado só tem o número.
  // Uma query só para todas as conversas da tela, não uma por conversa.
  const phones = [...new Set((conversations ?? []).map((c) => c.patient_phone).filter(Boolean))]
  const { data: appointments } = phones.length
    ? await supabase
        .from('appointments')
        .select('patient_phone, scheduled_at')
        .eq('account_id', session.accountId)
        .in('patient_phone', phones)
        .neq('status', 'cancelado')
        .order('scheduled_at', { ascending: true })
    : { data: [] }

  const visits = summarizeVisits(appointments ?? [])

  // Solicitação de agendamento mais recente de cada conversa (unidade com
  // agenda externa). Erro (ex.: migration pendente) = nenhuma, sem quebrar a tela.
  const conversationIds = (conversations ?? []).map((c) => c.id)
  const { data: requestRows, error: requestsError } = conversationIds.length
    ? await supabase
        .from('handoff_logs')
        .select('id, conversation_id, summary, sent_at, resolved_at, workspaces(name)')
        .in('conversation_id', conversationIds)
        .eq('trigger_reason', 'external_scheduling')
        .not('summary', 'is', null)
        .order('sent_at', { ascending: false })
    : { data: [], error: null }
  const requestByConversation = new Map<string, ExternalRequestView>()
  for (const r of requestsError ? [] : (requestRows ?? [])) {
    if (!r.conversation_id || requestByConversation.has(r.conversation_id)) continue
    const unitName = (r.workspaces as unknown as { name: string } | null)?.name ?? 'Unidade'
    requestByConversation.set(r.conversation_id, {
      id: r.id,
      lines: formatExternalRequestLines(r.summary as ExternalRequestSummary, unitName),
      sentAt: r.sent_at,
      resolvedAt: r.resolved_at,
    })
  }

  const items: ConversationWithMessages[] = (conversations ?? []).map((c) => {
    const messages = [...(c.messages ?? [])].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    )
    const patient = c.patients as unknown as
      | { id: string; full_name: string; tags: string[] | null; notes: string | null }
      | null
    const visit = visits.get(c.patient_phone)
    return {
      id: c.id,
      patient_phone: c.patient_phone,
      patient_name: patient?.full_name ?? null,
      patient_id: patient?.id ?? null,
      patient_tags: patient?.tags ?? [],
      patient_notes: patient?.notes ?? null,
      last_visit: visit?.last ?? null,
      next_appointment: visit?.next ?? null,
      status: c.status,
      bot_paused: c.bot_paused,
      archived_at: c.archived_at,
      started_at: c.started_at,
      last_message: messages.at(-1)?.content ?? null,
      last_message_at: messages.at(-1)?.sent_at ?? null,
      unread: isUnread(messages.at(-1)?.role, c.status),
      external_request: requestByConversation.get(c.id) ?? null,
      messages,
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Conversas</h1>
        <p className="text-sm text-gray-400">Atendimentos conduzidos pela Maria no WhatsApp.</p>
      </div>
      <BotInboxClient initialConversations={items} />
    </div>
  )
}
