'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Archive, ArchiveRestore, Lock, Send } from 'lucide-react'
import type { MessageRole, ConversationStatus } from '@/types/database'
import { InitialsAvatar } from './InitialsAvatar'

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
  botPaused: boolean
  archivedAt: string | null
  messages: DetailMessage[]
  onSend: (message: string) => Promise<void>
  onResolve: () => Promise<void>
  onReactivateBot: () => Promise<void>
  onToggleArchived: (archived: boolean) => Promise<void>
}

const RINGS =
  'radial-gradient(circle at 28% 22%, var(--cyan-10) 0, transparent 42%), repeating-radial-gradient(circle at 50% 32%, transparent 0 46px, rgba(27,48,104,0.035) 46px 47px)'

type Tone = 'cyan' | 'amber' | 'navy'

const PILL: Record<Tone, string> = {
  cyan: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  amber: 'bg-amber-100 text-amber-700',
  navy: 'bg-[var(--navy-06)] text-[var(--navy)]',
}

function statusInfo(status: ConversationStatus, botPaused: boolean, archived: boolean): {
  tone: Tone
  label: string
  hint: string
} {
  if (archived)
    return {
      tone: 'navy',
      label: 'Arquivada',
      hint: 'Some da caixa de entrada, mas volta se o paciente responder.',
    }
  if (botPaused)
    return {
      tone: 'amber',
      label: 'Bot pausado',
      hint: 'O agente não responde automaticamente até você reativar.',
    }
  if (status === 'handoff')
    return { tone: 'amber', label: 'Atenção humana', hint: 'Aguardando resposta da equipe.' }
  if (status === 'resolved')
    return { tone: 'navy', label: 'Resolvida', hint: 'Conversa encerrada.' }
  return { tone: 'cyan', label: 'Bot ativo', hint: 'O agente responde normalmente ao paciente.' }
}

export function ConversationDetail({
  conversationId,
  patientPhone,
  patientName,
  status,
  botPaused,
  archivedAt,
  messages,
  onSend,
  onResolve,
  onReactivateBot,
  onToggleArchived,
}: ConversationDetailProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, conversationId])

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

  const handleReactivate = async () => {
    setReactivating(true)
    try {
      await onReactivateBot()
    } finally {
      setReactivating(false)
    }
  }

  const handleToggleArchived = async () => {
    setArchiving(true)
    try {
      await onToggleArchived(!archivedAt)
    } finally {
      setArchiving(false)
    }
  }

  const title = patientName ?? patientPhone
  const info = statusInfo(status, botPaused, Boolean(archivedAt))

  return (
    <div key={conversationId} className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-[var(--navy-06)] px-5 py-3">
        <InitialsAvatar label={title} seed={conversationId} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--navy)]">{title}</p>
          <p className="truncate text-xs text-gray-400">
            {patientPhone || 'Sandbox'} · {messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {status !== 'resolved' && (
            <Button variant="outline" size="sm" onClick={onResolve}>
              Marcar como resolvida
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleArchived}
            disabled={archiving}
            className="gap-1.5"
          >
            {archivedAt ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {archivedAt ? 'Desarquivar' : 'Arquivar'}
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#F4F6FB] px-5 py-6"
        style={{ backgroundImage: RINGS }}
      >
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">Nenhuma mensagem nesta conversa.</p>
        )}
        {messages.map((m) => {
          if (m.role === 'system') {
            return (
              <div key={m.id} className="flex justify-center">
                <span className="rounded-full bg-[var(--navy-06)] px-3 py-1 text-[11px] text-gray-500">
                  {m.content}
                </span>
              </div>
            )
          }
          const incoming = m.role === 'user'
          return (
            <div key={m.id} className={cn('flex', incoming ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                  incoming
                    ? 'rounded-tl-sm bg-white text-[var(--navy-dark)] shadow-[var(--shadow-sm)]'
                    : 'rounded-tr-sm border border-[var(--cyan-20)] bg-[var(--cyan-10)] text-[var(--navy-dark)]'
                )}
              >
                {m.content}
                <span className="mt-1 block text-right text-[10px] text-gray-400">
                  {new Date(m.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--navy-06)] px-5 py-2.5 text-xs text-gray-500">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
            PILL[info.tone]
          )}
        >
          <Lock className="h-3 w-3" />
          {info.label}
        </span>
        <span>{info.hint}</span>
        {botPaused && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReactivate}
            disabled={reactivating}
            className="ml-auto shrink-0 border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
          >
            {reactivating ? 'Reativando...' : 'Reativar bot'}
          </Button>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-[var(--navy-06)] p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Responder manualmente ao paciente..."
          className="min-h-[44px] flex-1 resize-none rounded-2xl"
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
          className="h-11 gap-1.5 bg-[var(--cyan)] px-4 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)] hover:text-white"
        >
          <Send className="h-4 w-4" />
          Enviar
        </Button>
      </div>
    </div>
  )
}
