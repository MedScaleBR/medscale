'use client'

import { useMemo, useState } from 'react'
import { ConversationList, type ConversationListItem } from './ConversationList'
import { ConversationDetail, type DetailMessage } from './ConversationDetail'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackBotPausedManually, trackBotResumed } from '@/lib/analytics/posthog'
import type { ConversationStatus } from '@/types/database'

export interface ConversationWithMessages extends ConversationListItem {
  messages: DetailMessage[]
}

export function BotInboxClient({ initialConversations }: { initialConversations: ConversationWithMessages[] }) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null)
  const analyticsBase = useAnalyticsBase()

  const selected = useMemo(() => conversations.find((c) => c.id === selectedId) ?? null, [conversations, selectedId])

  const handleSend = async (message: string) => {
    if (!selected) return
    const res = await fetch('/api/bot/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: selected.id, message }),
    })
    if (res.ok) {
      const saved = await res.json()
      // Responder manualmente pausa o bot — só conta como pausa manual na
      // transição (a 1ª resposta humana), não a cada mensagem seguinte.
      if (!selected.bot_paused) trackBotPausedManually(analyticsBase)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                status: 'handoff' as ConversationStatus,
                bot_paused: true,
                last_message: message,
                messages: [...c.messages, saved],
              }
            : c
        )
      )
    }
  }

  const handleResolve = async () => {
    if (!selected) return
    const res = await fetch(`/api/bot/conversations/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, status: 'resolved' as ConversationStatus } : c))
      )
    }
  }

  const handleReactivateBot = async () => {
    if (!selected) return
    const res = await fetch(`/api/bot/conversations/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_paused: false }),
    })
    if (res.ok) {
      trackBotResumed(analyticsBase)
      setConversations((prev) => prev.map((c) => (c.id === selected.id ? { ...c, bot_paused: false } : c)))
    }
  }

  const handleToggleArchived = async (archived: boolean) => {
    if (!selected) return
    const res = await fetch(`/api/bot/conversations/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    if (res.ok) {
      const data = await res.json()
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, archived_at: data.archived_at } : c))
      )
    }
  }

  return (
    <div className="grid h-[calc(100vh-160px)] grid-cols-1 gap-0 overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)] md:grid-cols-[340px_1fr]">
      <div className="min-h-0 overflow-hidden border-r border-[var(--navy-06)]">
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="min-h-0 overflow-hidden">
        {selected ? (
          <ConversationDetail
            conversationId={selected.id}
            patientPhone={selected.patient_phone}
            patientName={selected.patient_name}
            status={selected.status}
            botPaused={selected.bot_paused}
            archivedAt={selected.archived_at}
            messages={selected.messages}
            onSend={handleSend}
            onResolve={handleResolve}
            onReactivateBot={handleReactivateBot}
            onToggleArchived={handleToggleArchived}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Selecione uma conversa
          </div>
        )}
      </div>
    </div>
  )
}
