import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationWithMessages } from '@/components/bot/BotInboxClient'
import type { ExternalRequestView } from '@/components/bot/ExternalRequestCard'
import { isUnread, summarizeVisits } from '@/lib/bot/inbox'
import { isBotPaused } from '@/lib/bot/pause'
import { formatExternalRequestLines } from '@/lib/bot/unit-settings'
import type { Database, ExternalRequestSummary } from '@/types/database'

/** Quantas conversas a tela /bot carrega de início. */
export const INBOX_PAGE_SIZE = 100

// Monta as conversas da tela /bot já com mensagens, paciente, consultas,
// solicitação de agendamento e pausa. Usada pela página (as mais recentes) e
// pela busca (conversas específicas, por id).
export async function loadInboxConversations(
  supabase: SupabaseClient<Database>,
  accountId: string,
  opts: { ids?: string[] } = {}
): Promise<ConversationWithMessages[]> {
  if (opts.ids && opts.ids.length === 0) return []

  // Conversas de todas as unidades da account, inclusive as que ainda não têm
  // unidade (a Clara só grava quando o paciente confirma). A RLS já limita às
  // unidades que o usuário pode acessar.
  let query = supabase
    .from('conversations')
    .select(
      'id, workspace_id, patient_phone, patient_id, status, bot_paused, archived_at, started_at, workspaces(name), patients(id, full_name, tags, notes), messages(id, role, content, sent_at)'
    )
    .eq('account_id', accountId)
  if (opts.ids) query = query.in('id', opts.ids)
  const { data: conversations } = await query.order('started_at', { ascending: false }).limit(INBOX_PAGE_SIZE)

  // Última/próxima consulta da barra de contexto: o vínculo é o telefone, não
  // patient_id — conversa de paciente ainda não cadastrado só tem o número.
  // Uma query só para todas as conversas da tela, não uma por conversa.
  const phones = [...new Set((conversations ?? []).map((c) => c.patient_phone).filter(Boolean))]
  const { data: appointments } = phones.length
    ? await supabase
        .from('appointments')
        .select('patient_phone, scheduled_at')
        .eq('account_id', accountId)
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
  // Foto da carteirinha mais recente de cada conversa com solicitação. Só o id
  // e o tipo vão ao client; a imagem abre por /api/bot/attachments/[id].
  // Erro (ex.: migration pendente) = sem foto.
  const requestConversationIds = [...new Set((requestsError ? [] : (requestRows ?? [])).map((r) => r.conversation_id).filter((v): v is string => !!v))]
  const { data: cardRows, error: cardsError } = requestConversationIds.length
    ? await supabase
        .from('conversation_attachments')
        .select('id, conversation_id, mime_type')
        .in('conversation_id', requestConversationIds)
        .eq('kind', 'insurance_card')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  const cardByConversation = new Map<string, { id: string; isPdf: boolean }>()
  for (const c of cardsError ? [] : (cardRows ?? [])) {
    if (!cardByConversation.has(c.conversation_id)) {
      cardByConversation.set(c.conversation_id, { id: c.id, isPdf: c.mime_type === 'application/pdf' })
    }
  }

  const requestByConversation = new Map<string, ExternalRequestView>()
  for (const r of requestsError ? [] : (requestRows ?? [])) {
    if (!r.conversation_id || requestByConversation.has(r.conversation_id)) continue
    const unitName = (r.workspaces as unknown as { name: string } | null)?.name ?? 'Unidade'
    requestByConversation.set(r.conversation_id, {
      id: r.id,
      lines: formatExternalRequestLines(r.summary as ExternalRequestSummary, unitName),
      sentAt: r.sent_at,
      resolvedAt: r.resolved_at,
      cardPhoto: cardByConversation.get(r.conversation_id) ?? null,
    })
  }

  // Pausa temporária (secretária respondendo pelo celular). Consulta à parte:
  // erro (ex.: migration pendente) = nenhuma pausa, sem quebrar a tela.
  const { data: pauseRows, error: pauseError } = conversationIds.length
    ? await supabase.from('conversations').select('id, bot_paused_until').in('id', conversationIds)
    : { data: [], error: null }
  const pausedUntil = new Map((pauseError ? [] : (pauseRows ?? [])).map((r) => [r.id, r.bot_paused_until]))

  // Nome do perfil do WhatsApp de cada paciente. Consulta à parte pelo mesmo
  // motivo: sem a migration, só não aparece.
  const patientIds = [...new Set((conversations ?? []).map((c) => c.patient_id).filter((v): v is string => !!v))]
  const { data: waRows, error: waError } = patientIds.length
    ? await supabase.from('patients').select('id, whatsapp_name').in('id', patientIds)
    : { data: [], error: null }
  const whatsappNames = new Map((waError ? [] : (waRows ?? [])).map((r) => [r.id, r.whatsapp_name]))

  return (conversations ?? []).map((c) => {
    const messages = [...(c.messages ?? [])].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    )
    const patient = c.patients as unknown as
      | { id: string; full_name: string; tags: string[] | null; notes: string | null }
      | null
    const visit = visits.get(c.patient_phone)
    const unit = c.workspaces as unknown as { name: string } | null
    return {
      id: c.id,
      unit_name: c.workspace_id ? (unit?.name ?? 'Unidade') : null,
      patient_phone: c.patient_phone,
      patient_name: patient?.full_name ?? null,
      patient_whatsapp_name: patient ? (whatsappNames.get(patient.id) ?? null) : null,
      patient_id: patient?.id ?? null,
      patient_tags: patient?.tags ?? [],
      patient_notes: patient?.notes ?? null,
      last_visit: visit?.last ?? null,
      next_appointment: visit?.next ?? null,
      status: c.status,
      bot_paused: isBotPaused({ bot_paused: c.bot_paused, bot_paused_until: pausedUntil.get(c.id) ?? null }),
      archived_at: c.archived_at,
      started_at: c.started_at,
      last_message: messages.at(-1)?.content ?? null,
      last_message_at: messages.at(-1)?.sent_at ?? null,
      unread: isUnread(messages.at(-1)?.role, c.status),
      external_request: requestByConversation.get(c.id) ?? null,
      messages,
    }
  })
}
