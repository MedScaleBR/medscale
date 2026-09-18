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
import {
  Archive,
  ArchiveRestore,
  Bot,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  Lock,
  MessageCircle,
  MoreVertical,
  Send,
} from 'lucide-react'
import type { MessageRole, ConversationStatus } from '@/types/database'
import { InitialsAvatar } from './InitialsAvatar'
import { ConversationContextBar } from './ConversationContextBar'
import { ScheduleDialog } from './ScheduleDialog'

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
  patientId: string | null
  patientTags: string[]
  patientNotes: string | null
  lastVisit: string | null
  nextAppointment: string | null
  status: ConversationStatus
  botPaused: boolean
  archivedAt: string | null
  messages: DetailMessage[]
  onSend: (message: string) => Promise<void>
  onResolve: () => Promise<void>
  onToggleBotPaused: (paused: boolean) => Promise<void>
  onToggleArchived: (archived: boolean) => Promise<void>
  onNotesSaved: (notes: string) => void
  onScheduled: (scheduledAt: string) => void
  onBack?: () => void
}

// Fundo discreto: os anéis são marca, não decoração da conversa — fortes
// demais, competem com o texto das mensagens.
const RINGS =
  'radial-gradient(circle at 28% 22%, var(--cyan-10) 0, transparent 42%), repeating-radial-gradient(circle at 50% 32%, transparent 0 46px, rgba(27,48,104,0.018) 46px 47px)'

const QUICK_REPLIES = [
  'Perfeito, te confirmo em breve!',
  'Consigo te encaixar amanhã às 10h.',
  'Pode me enviar seu convênio, por favor?',
]

type Tone = 'cyan' | 'amber' | 'navy'

const PILL: Record<Tone, string> = {
  cyan: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  amber: 'bg-amber-100 text-amber-700',
  navy: 'bg-[var(--navy-06)] text-[var(--navy)]',
}

const ICON_BUTTON =
  'flex size-8 items-center justify-center rounded-lg border border-[var(--navy-06)] bg-white text-gray-500 transition-colors hover:bg-[var(--navy-06)] disabled:opacity-50'

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
  patientId,
  patientTags,
  patientNotes,
  lastVisit,
  nextAppointment,
  status,
  botPaused,
  archivedAt,
  messages,
  onSend,
  onResolve,
  onToggleBotPaused,
  onToggleArchived,
  onNotesSaved,
  onScheduled,
  onBack,
}: ConversationDetailProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
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

  const handleTogglePause = async () => {
    setPausing(true)
    try {
      await onToggleBotPaused(!botPaused)
    } finally {
      setPausing(false)
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
    // h-full sozinho, sem par h-dvh/md:h-full: variante de media query não
    // soma especificidade, então quem vencia era só a ordem no CSS gerado — o
    // h-dvh ganhava mesmo no desktop, o painel ficava 216px mais alto que o
    // card e o overflow-hidden do pai comia o rodapé e a caixa de resposta.
    // Quem define a altura é o pai: grid no desktop, fixed inset-0 no mobile.
    <div key={conversationId} className="flex h-full flex-col bg-white">
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
          <p className="truncate text-xs text-gray-400">{patientPhone || 'Sandbox'}</p>
        </div>
        <span
          title={info.hint}
          className={cn(
            // Visível também no mobile: a barra de status do rodapé saiu, e sem
            // ela esta pílula é o único lugar que diz em que pé está a conversa.
            'inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            PILL[info.tone]
          )}
        >
          <Lock className="h-3 w-3" />
          {info.label}
        </span>

        {/* Ações inline no desktop */}
        <div className="ml-auto hidden shrink-0 items-center gap-1.5 md:flex">
          <button
            onClick={handleTogglePause}
            disabled={pausing}
            aria-pressed={botPaused}
            title={botPaused ? 'Reativar o bot nesta conversa' : 'Pausar o bot nesta conversa'}
            className={cn(
              ICON_BUTTON,
              botPaused && 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
            )}
          >
            <Bot className="h-4 w-4" />
          </button>
          {status !== 'resolved' && (
            <button
              onClick={onResolve}
              title="Marcar como resolvida"
              aria-label="Marcar como resolvida"
              className={ICON_BUTTON}
            >
              <CalendarCheck className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={handleToggleArchived}
            disabled={archiving}
            title={archivedAt ? 'Desarquivar' : 'Arquivar'}
            aria-label={archivedAt ? 'Desarquivar' : 'Arquivar'}
            className={ICON_BUTTON}
          >
            {archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </button>
          <Button size="sm" onClick={() => setScheduleOpen(true)} className="gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Agendar
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
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>Agendar consulta</DropdownMenuItem>
              <DropdownMenuItem onClick={handleTogglePause} disabled={pausing}>
                {botPaused ? 'Reativar bot' : 'Pausar bot'}
              </DropdownMenuItem>
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

      <ConversationContextBar
        key={patientId ?? conversationId}
        patientId={patientId}
        tags={patientTags}
        lastVisit={lastVisit}
        nextAppointment={nextAppointment}
        notes={patientNotes}
        onNotesSaved={onNotesSaved}
      />

      {botPaused && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 md:px-5">
          <p className="text-xs text-amber-700">
            Bot pausado nessa conversa — não responde automaticamente até você reativar.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTogglePause}
            disabled={pausing}
            className="ml-auto shrink-0 border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
          >
            {pausing ? 'Reativando...' : 'Reativar bot'}
          </Button>
        </div>
      )}

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

      <div className="flex items-end gap-2 border-t border-[var(--navy-06)] p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Respostas rápidas"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--navy-06)] bg-white text-gray-500 hover:bg-[var(--navy-06)]"
          >
            <MessageCircle className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-[16rem]">
            {QUICK_REPLIES.map((reply) => (
              <DropdownMenuItem key={reply} onClick={() => setDraft(reply)} className="whitespace-normal">
                {reply}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        patientName={patientName ?? patientPhone}
        patientPhone={patientPhone}
        patientId={patientId}
        onScheduled={onScheduled}
      />
    </div>
  )
}
