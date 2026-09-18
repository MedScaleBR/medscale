'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  matchesFilter,
  sortConversations,
  type InboxFilter,
  type InboxSort,
} from '@/lib/bot/inbox'
import { InitialsAvatar } from './InitialsAvatar'

export interface ConversationListItem {
  id: string
  patient_phone: string
  patient_name: string | null
  patient_id: string | null
  patient_tags: string[]
  patient_notes: string | null
  last_visit: string | null
  next_appointment: string | null
  status: 'open' | 'resolved' | 'handoff'
  bot_paused: boolean
  archived_at: string | null
  started_at: string
  last_message: string | null
  last_message_at: string | null
  unread: boolean
}

interface ConversationListProps {
  conversations: ConversationListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'open', label: 'Abertas' },
  { key: 'handoff', label: 'Handoff' },
  { key: 'resolved', label: 'Resolvidas' },
  { key: 'archived', label: 'Arquivadas' },
]

const STATUS_PILL: Record<ConversationListItem['status'], { label: string; className: string }> = {
  open: { label: 'Bot ativo', className: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]' },
  handoff: { label: 'Handoff', className: 'bg-amber-100 text-amber-700' },
  resolved: { label: 'Resolvida', className: 'bg-[var(--navy-06)] text-[var(--navy)]' },
}

function shortDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [sort, setSort] = useState<InboxSort>('recent')
  const [query, setQuery] = useState('')

  const counts = useMemo(
    () =>
      FILTERS.reduce(
        (acc, f) => ({ ...acc, [f.key]: conversations.filter((c) => matchesFilter(c, f.key)).length }),
        {} as Record<InboxFilter, number>
      ),
    [conversations]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = conversations.filter((c) => {
      if (!matchesFilter(c, filter)) return false
      if (!q) return true
      return (
        (c.patient_name ?? '').toLowerCase().includes(q) ||
        (c.patient_phone ?? '').toLowerCase().includes(q)
      )
    })
    return sortConversations(list, sort)
  }, [conversations, filter, sort, query])

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-col gap-2 border-b border-[var(--navy-06)] px-3 pt-3 pb-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nome ou telefone"
              aria-label="Buscar conversa"
              className="w-full rounded-lg border border-[var(--navy-06)] bg-[var(--navy-06)]/40 py-2 pr-3 pl-9 text-base text-gray-900 placeholder:text-gray-400 focus:border-[var(--cyan)] focus:bg-white focus:ring-2 focus:ring-[var(--cyan-20)] focus:outline-none md:text-sm"
            />
          </div>
          <Select
            items={[
              { value: 'recent', label: 'Recentes' },
              { value: 'unread', label: 'Não lidas' },
            ]}
            value={sort}
            onValueChange={(v) => v && setSort(v as InboxSort)}
          >
            <SelectTrigger aria-label="Ordenar conversas" className="w-[7.5rem] shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recentes</SelectItem>
              <SelectItem value="unread">Não lidas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                filter === f.key
                  ? 'bg-[var(--cyan-dark)] text-white'
                  : 'bg-[var(--navy-06)] text-gray-600 hover:bg-[var(--navy-10)]'
              )}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-400">
          {query.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa nesta aba.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((c) => {
            const label = c.patient_name ?? c.patient_phone
            const pill = STATUS_PILL[c.status]
            return (
              <li key={c.id} className="border-b border-[var(--navy-06)] last:border-b-0">
                <button
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 border-l-2 border-transparent px-3 py-2.5 text-left transition-colors hover:bg-[var(--navy-06)]/50',
                    selectedId === c.id && 'border-[var(--cyan)] bg-[var(--cyan-10)] hover:bg-[var(--cyan-10)]',
                    c.archived_at && 'opacity-60'
                  )}
                >
                  <InitialsAvatar label={label} seed={c.id} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate text-sm text-gray-900',
                          c.unread ? 'font-semibold' : 'font-medium'
                        )}
                      >
                        {label}
                      </span>
                      {c.unread && (
                        <span
                          aria-label="Não lida"
                          className="size-1.5 shrink-0 rounded-full bg-[var(--cyan-dark)]"
                        />
                      )}
                      <span className="ml-auto shrink-0 text-[11px] text-gray-400">
                        {shortDate(c.last_message_at ?? c.started_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {c.bot_paused && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          Pausado
                        </span>
                      )}
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          pill.className
                        )}
                      >
                        {pill.label}
                      </span>
                      <p className="truncate text-xs text-gray-400">{c.last_message ?? 'Sem mensagens'}</p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
