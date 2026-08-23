'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MessageRole, ConversationStatus } from '@/types/database'

export interface DetailMessage {
  id: string
  role: MessageRole
  content: string
  sent_at: string
}

interface ConversationDetailProps {
  conversationId: string
  patientPhone: string
  patientName: string | null
  status: ConversationStatus
  messages: DetailMessage[]
  onSend: (message: string) => Promise<void>
  onResolve: () => Promise<void>
}

export function ConversationDetail({
  conversationId,
  patientPhone,
  patientName,
  status,
  messages,
  onSend,
  onResolve,
}: ConversationDetailProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!draft.trim()) return
    setSending(true)
    try {
      await onSend(draft.trim())
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div key={conversationId} className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--navy-06)] px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{patientName ?? patientPhone}</p>
          <p className="text-xs text-gray-400">{patientPhone}</p>
        </div>
        {status !== 'resolved' && (
          <Button variant="outline" size="sm" onClick={onResolve}>
            Marcar como resolvida
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'max-w-[75%] rounded-2xl px-4 py-2 text-sm',
                m.role === 'user'
                  ? 'bg-[var(--navy-06)] text-gray-900'
                  : 'bg-[var(--cyan)] text-[var(--navy-dark)]'
              )}
            >
              {m.content}
              <p className="mt-1 text-[10px] opacity-60">
                {new Date(m.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t border-[var(--navy-06)] p-4">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Responder manualmente ao paciente..."
          className="min-h-[44px] flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
