import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { BotInboxClient } from '@/components/bot/BotInboxClient'
import { loadInboxConversations } from '@/lib/bot/load-inbox'

export default async function BotPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // As mais recentes; conversas mais antigas chegam pela busca.
  const supabase = await createClient()
  const items = await loadInboxConversations(supabase, session.accountId)

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
