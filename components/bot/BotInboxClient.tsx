'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ConversationList, type ConversationListItem } from './ConversationList'
import { ConversationDetail, type DetailMessage } from './ConversationDetail'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackBotPausedManually, trackBotResumed } from '@/lib/analytics/posthog'
import { useActiveConversation } from './active-conversation'
import type { ConversationStatus } from '@/types/database'

export interface ConversationWithMessages extends ConversationListItem {
  messages: DetailMessage[]
}

export function BotInboxClient({ initialConversations }: { initialConversations: ConversationWithMessages[] }) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null)
  // No mobile (< md) a lista e o detalhe não cabem juntos: mostramos um por vez.
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
  const analyticsBase = useAnalyticsBase()
  const { setActiveConversationId, pendingConversationId, clearPendingConversation } = useActiveConversation()

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setMobilePane('detail')
  }

  const selected = useMemo(() => conversations.find((c) => c.id === selectedId) ?? null, [conversations, selectedId])

  // Publica a conversa aberta para o HandoffToastListener (no layout) não
  // mostrar toast da conversa que já está na tela. Limpa ao desmontar.
  useEffect(() => {
    setActiveConversationId(selectedId)
    return () => setActiveConversationId(null)
  }, [selectedId, setActiveConversationId])

  // Clique num toast de handoff pede para abrir aquela conversa. Consome assim
  // que ela existir na lista e limpa o pedido.
  useEffect(() => {
    if (pendingConversationId && conversations.some((c) => c.id === pendingConversationId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(pendingConversationId)
      setMobilePane('detail')
      clearPendingConversation()
    }
  }, [pendingConversationId, conversations, clearPendingConversation])

  // Deep-link vindo da notificação push de handoff (/bot?c=<id>). Sincroniza
  // uma vez, depois da hidratação — evita useSearchParams (exigiria Suspense
  // boundary nesta página) e mismatch de hidratação.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('c')
    if (target && conversations.some((c) => c.id === target)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(target)
      setMobilePane('detail')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {/* LISTA — sempre no desktop; no mobile só quando mobilePane === 'list' */}
      <div
        className={cn(
          'min-h-0 overflow-hidden border-r border-[var(--navy-06)]',
          mobilePane === 'detail' && 'hidden md:block',
        )}
      >
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={handleSelect} />
      </div>

      {/* DETALHE — painel no desktop; overlay full-screen no mobile */}
      <div
        className={cn(
          'min-h-0 overflow-hidden',
          mobilePane === 'list'
            ? 'hidden md:block'
            : 'fixed inset-0 z-50 bg-white md:static md:z-auto',
        )}
      >
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
            onBack={() => setMobilePane('list')}
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
