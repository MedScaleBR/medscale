'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

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

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  handoff: 'bg-amber-100 text-amber-700',
  resolved: 'bg-[var(--navy-06)] text-[var(--navy)]',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Bot ativo',
  handoff: 'Atenção humana',
  resolved: 'Resolvida',
}

interface ConversationListProps {
  conversations: ConversationListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(
    () => conversations.filter((c) => showArchived || !c.archived_at),
    [conversations, showArchived]
  )

  return (
    <div className="flex h-full flex-col">
      <label className="flex items-center gap-2 border-b border-[var(--navy-06)] px-4 py-2 text-xs text-gray-500">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300"
        />
        Mostrar arquivadas
      </label>
      {visible.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-400">Nenhuma conversa ainda.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--navy-06)] overflow-y-auto">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                className={cn(
                  'w-full px-4 py-3 text-left transition-colors hover:bg-[var(--navy-06)]',
                  selectedId === c.id && 'bg-[var(--cyan-10)]',
                  c.archived_at && 'opacity-60'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {c.patient_name ?? c.patient_phone}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {c.archived_at && (
                      <Badge className="border-none bg-gray-100 text-[10px] text-gray-500">Arquivada</Badge>
                    )}
                    {c.bot_paused && (
                      <Badge className="border-none bg-amber-100 text-[10px] text-amber-700">Bot pausado</Badge>
                    )}
                    <Badge className={cn('border-none text-[10px]', STATUS_STYLE[c.status])}>{STATUS_LABEL[c.status]}</Badge>
                  </div>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-400">{c.last_message ?? 'Sem mensagens'}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
