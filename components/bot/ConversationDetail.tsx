'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { parseRichText } from '@/lib/bot/rich-text'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Archive, ArchiveRestore, ChevronLeft, Lock, MoreVertical, Send } from 'lucide-react'
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
  onBack?: () => void
}

// Fundo discreto: os anéis são marca, não decoração da conversa — fortes
// demais, competem com o texto das mensagens.
const RINGS =
  'radial-gradient(circle at 28% 22%, var(--cyan-10) 0, transparent 42%), repeating-radial-gradient(circle at 50% 32%, transparent 0 46px, rgba(27,48,104,0.018) 46px 47px)'

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
  onBack,
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
    <div key={conversationId} className="flex h-dvh flex-col bg-white md:h-full">
      <div className="flex items-center gap-2 border-b border-[var(--navy-06)] px-4 py-3 md:gap-3 md:px-5">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-[var(--navy-06)] md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <InitialsAvatar label={title} seed={conversationId} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--navy)]">{title}</p>
          <p className="truncate text-xs text-gray-400">
            {patientPhone || 'Sandbox'} · {messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}
          </p>
        </div>

        {/* Ações inline no desktop */}
        <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
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

        {/* Ações no menu ⋯ no mobile */}
        <div className="ml-auto shrink-0 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ações da conversa"
              className="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-[var(--navy-06)]"
            >
              <MoreVertical className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {status !== 'resolved' && (
                <DropdownMenuItem onClick={onResolve}>Marcar como resolvida</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleToggleArchived} disabled={archiving}>
                {archivedAt ? 'Desarquivar' : 'Arquivar'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-[#F4F6FB] px-5 py-6"
        style={{ backgroundImage: RINGS }}
      >
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">Nenhuma mensagem nesta conversa.</p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'system') {
            return (
              <div key={m.id} className="mt-4 flex justify-center first:mt-0">
                <span className="rounded-full bg-[var(--navy-06)] px-3 py-1 text-[11px] text-gray-500">
                  {m.content}
                </span>
              </div>
            )
          }
          const incoming = m.role === 'user'
          // Mensagens seguidas do mesmo lado viram um bloco: só a primeira tem
          // o canto de "bico" e só a última mostra a hora. Repetir os dois em
          // cada balão é o que deixava a conversa visualmente picotada.
          const startsRun = messages[i - 1]?.role !== m.role
          const endsRun = messages[i + 1]?.role !== m.role
          return (
            <div
              key={m.id}
              className={cn(
                'flex first:mt-0',
                startsRun ? 'mt-4' : 'mt-0.5',
                incoming ? 'justify-start' : 'justify-end'
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words sm:max-w-[46ch]',
                  incoming
                    ? 'bg-white text-[var(--navy-dark)] shadow-[var(--shadow-sm)]'
                    : 'border border-[var(--cyan-20)] bg-[var(--cyan-10)] text-[var(--navy-dark)]',
                  startsRun && (incoming ? 'rounded-tl-sm' : 'rounded-tr-sm')
                )}
              >
                {parseRichText(m.content).map((seg, s) =>
                  seg.bold ? (
                    <strong key={s} className="font-semibold">
                      {seg.text}
                    </strong>
                  ) : (
                    <Fragment key={s}>{seg.text}</Fragment>
                  )
                )}
                {endsRun && (
                  <span className="mt-1 block text-right text-[10px] leading-none text-gray-400">
                    {new Date(m.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-[var(--navy-06)] px-4 py-2.5 text-xs text-gray-500 md:flex-row md:flex-wrap md:items-center md:gap-x-2 md:gap-y-1 md:px-5">
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 font-medium',
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
            className="mt-1 w-full shrink-0 border-amber-300 bg-white text-amber-700 hover:bg-amber-100 md:mt-0 md:ml-auto md:w-auto"
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
