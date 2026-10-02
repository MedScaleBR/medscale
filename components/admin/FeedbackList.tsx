'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FeedbackStatus } from '@/types/database'

export interface FeedbackRow {
  id: string
  message: string
  status: FeedbackStatus
  createdAt: string
  accountId: string | null
  accountName: string | null
  authorName: string | null
  authorEmail: string | null
}

const STATUS_FILTER_ITEMS = {
  new: 'Não lidos',
  reviewed: 'Lidos',
  all: 'Todos',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function FeedbackList({ feedback: initialFeedback }: { feedback: FeedbackRow[] }) {
  const [feedback, setFeedback] = useState(initialFeedback)
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('new')

  const toggleStatus = async (item: FeedbackRow) => {
    const nextStatus: FeedbackStatus = item.status === 'new' ? 'reviewed' : 'new'
    setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: nextStatus } : f)))
    await fetch(`/api/admin/feedback/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
  }

  const filtered = useMemo(
    () => (statusFilter === 'all' ? feedback : feedback.filter((f) => f.status === statusFilter)),
    [feedback, statusFilter]
  )

  return (
    <div className="space-y-4">
      <Select
        items={STATUS_FILTER_ITEMS}
        value={statusFilter}
        onValueChange={(v) => v && setStatusFilter(v as FeedbackStatus | 'all')}
      >
        <SelectTrigger className="h-9 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">Não lidos</SelectItem>
          <SelectItem value="reviewed">Lidos</SelectItem>
          <SelectItem value="all">Todos</SelectItem>
        </SelectContent>
      </Select>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhum feedback encontrado.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {filtered.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm whitespace-pre-wrap text-gray-900">{item.message}</p>
                  <p className="mt-1.5 text-xs text-gray-400">
                    {item.accountId ? (
                      <Link href={`/admin/accounts/${item.accountId}`} className="hover:text-[var(--cyan-dark)]">
                        {item.accountName ?? 'Cliente'}
                      </Link>
                    ) : (
                      'Sem cliente'
                    )}
                    {' · '}
                    {item.authorName ?? item.authorEmail ?? 'Usuário removido'}
                    {' · '}
                    {formatDate(item.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleStatus(item)} className="shrink-0">
                  {item.status === 'new' ? 'Marcar como lido' : 'Marcar como não lido'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
