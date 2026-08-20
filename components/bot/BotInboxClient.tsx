'use client'

import { useMemo, useState } from 'react'
import { ConversationList, type ConversationListItem } from './ConversationList'
import { ConversationDetail, type DetailMessage } from './ConversationDetail'
import type { ConversationStatus } from '@/types/database'

export interface ConversationWithMessages extends ConversationListItem {
  messages: DetailMessage[]
}

export function BotInboxClient({ initialConversations }: { initialConversations: ConversationWithMessages[] }) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null)

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
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, status: 'handoff' as ConversationStatus, last_message: message, messages: [...c.messages, saved] }
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

  return (
    <div className="grid h-[calc(100vh-160px)] grid-cols-1 gap-0 overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)] md:grid-cols-[280px_1fr]">
      <div className="border-r border-[var(--navy-06)]">
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div>
        {selected ? (
          <ConversationDetail
            conversationId={selected.id}
            patientPhone={selected.patient_phone}
            patientName={selected.patient_name}
            status={selected.status}
            messages={selected.messages}
            onSend={handleSend}
            onResolve={handleResolve}
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
