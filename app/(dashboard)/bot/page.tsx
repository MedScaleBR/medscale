import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotInboxClient, type ConversationWithMessages } from '@/components/bot/BotInboxClient'

export default async function BotPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, patient_phone, patient_id, status, started_at, patients(full_name), messages(id, role, content, sent_at)')
    .eq('workspace_id', session.workspaceId)
    .order('started_at', { ascending: false })
    .limit(50)

  const items: ConversationWithMessages[] = (conversations ?? []).map((c) => {
    const messages = [...(c.messages ?? [])].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    )
    return {
      id: c.id,
      patient_phone: c.patient_phone,
      patient_name: (c.patients as unknown as { full_name: string } | null)?.full_name ?? null,
      status: c.status,
      started_at: c.started_at,
      last_message: messages.at(-1)?.content ?? null,
      messages,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Bot WhatsApp</h1>
        <p className="text-sm text-gray-400">Conversas conduzidas pelo agente e disponíveis para atendimento humano.</p>
      </div>
      <BotInboxClient initialConversations={items} />
    </div>
  )
}
