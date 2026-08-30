'use client'

import { useMemo, useState } from 'react'
import { Lock, Search, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InitialsAvatar } from './InitialsAvatar'

export interface ConversationListItem {
  id: string
  patient_phone: string
  patient_name: string | null
  status: 'open' | 'resolved' | 'handoff'
  bot_paused: boolean
  archived_at: string | null
  started_at: string
  last_message: string | null
}

interface ConversationListProps {
  conversations: ConversationListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const SECTIONS: { key: ConversationListItem['status']; label: string }[] = [
  { key: 'handoff', label: 'Em andamento' },
  { key: 'open', label: 'Bot ativo' },
  { key: 'resolved', label: 'Resolvidas' },
]

function shortDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      if (!showArchived && c.archived_at) return false
      if (!q) return true
      return (
        (c.patient_name ?? '').toLowerCase().includes(q) ||
        (c.patient_phone ?? '').toLowerCase().includes(q)
      )
    })
  }, [conversations, showArchived, query])

  const grouped = useMemo(
    () => SECTIONS.map((s) => ({ ...s, items: visible.filter((c) => c.status === s.key) })).filter((s) => s.items.length),
    [visible]
  )

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-[var(--navy-06)] px-4 pt-4 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Atendimento ao vivo</p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--navy)]">
          Conversas <span className="text-[var(--cyan-dark)]">({visible.length})</span>
        </h2>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nome ou telefone"
            className="w-full rounded-full border border-[var(--navy-06)] bg-[var(--navy-06)]/40 py-2 pr-3 pl-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--cyan)] focus:bg-white focus:ring-2 focus:ring-[var(--cyan-20)] focus:outline-none"
          />
        </div>
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-[var(--cyan-dark)]"
          />
          Mostrar arquivadas
        </label>
      </div>

      {grouped.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-400">
          {query.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {grouped.map((section) => (
            <div key={section.key}>
              <p className="sticky top-0 z-10 bg-white/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 backdrop-blur">
                {section.label}
              </p>
              <ul>
                {section.items.map((c) => {
                  const label = c.patient_name ?? c.patient_phone
                  const needsAttention = c.bot_paused || c.status === 'handoff'
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => onSelect(c.id)}
                        className={cn(
                          'flex w-full items-start gap-3 border-l-2 border-transparent px-4 py-3 text-left transition-colors hover:bg-[var(--navy-06)]/50',
                          selectedId === c.id && 'border-[var(--cyan)] bg-[var(--cyan-10)] hover:bg-[var(--cyan-10)]',
                          c.archived_at && 'opacity-60'
                        )}
                      >
                        <InitialsAvatar label={label} seed={c.id} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-gray-900">{label}</span>
                            <span className="shrink-0 text-[11px] text-gray-400">{shortDate(c.started_at)}</span>
                          </div>
                          <div className="mt-0.5 flex items-end justify-between gap-2">
                            <p className="truncate text-xs text-gray-400">{c.last_message ?? 'Sem mensagens'}</p>
                            <span className="flex shrink-0 items-center gap-1 pb-0.5">
                              <Lock className="h-3 w-3 text-gray-300" />
                              {needsAttention && <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
