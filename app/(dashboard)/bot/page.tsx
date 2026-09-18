import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotInboxClient, type ConversationWithMessages } from '@/components/bot/BotInboxClient'
import { isUnread, summarizeVisits } from '@/lib/bot/inbox'

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
