'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface ConversationListItem {
  id: string
  patient_phone: string
  patient_name: string | null
  status: 'open' | 'resolved' | 'handoff'
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
  if (conversations.length === 0) {
    return <p className="p-6 text-center text-sm text-gray-400">Nenhuma conversa ainda.</p>
  }

  return (
    <ul className="h-full divide-y divide-[var(--navy-06)] overflow-y-auto">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onSelect(c.id)}
            className={cn(
              'w-full px-4 py-3 text-left transition-colors hover:bg-[var(--navy-06)]',
              selectedId === c.id && 'bg-[var(--cyan-10)]'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-gray-900">
                {c.patient_name ?? c.patient_phone}
              </span>
              <Badge className={cn('shrink-0 border-none text-[10px]', STATUS_STYLE[c.status])}>
                {STATUS_LABEL[c.status]}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-400">{c.last_message ?? 'Sem mensagens'}</p>
          </button>
        </li>
      ))}
    </ul>
  )
}
