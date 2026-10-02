'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConvertToTaskButton } from '@/components/admin/ConvertToTaskButton'
import { formatDateBR, initialsFrom } from '@/lib/admin/format'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
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
  /** Já existe tarefa criada a partir deste feedback. */
  tasked: boolean
}

type Filter = FeedbackStatus | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'new', label: 'Não lidos' },
  { value: 'reviewed', label: 'Lidos' },
  { value: 'all', label: 'Todos' },
]

const TASK_TITLE_MAX = 80

// Título da tarefa: a mensagem numa linha só, cortada no limite.
function taskTitleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim()
  return oneLine.length > TASK_TITLE_MAX ? `${oneLine.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…` : oneLine
}

export function FeedbackList({
  feedback: initialFeedback,
  header,
  loadError,
}: {
  feedback: FeedbackRow[]
  header: ReactNode
  loadError: string | null
}) {
  const router = useRouter()
  const [feedback, setFeedback] = useState(initialFeedback)
  const [filter, setFilter] = useState<Filter>('new')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const counts = useMemo(() => {
    const unread = feedback.filter((f) => f.status === 'new').length
    return { new: unread, reviewed: feedback.length - unread, all: feedback.length }
  }, [feedback])

  const visible = useMemo(
    () => (filter === 'all' ? feedback : feedback.filter((f) => f.status === filter)),
    [feedback, filter],
  )

  const setItemError = (id: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })

  // Otimista: troca o status na hora e desfaz se a API recusar.
  const toggleStatus = async (item: FeedbackRow) => {
    const previous = item.status
    const nextStatus: FeedbackStatus = previous === 'new' ? 'reviewed' : 'new'
    setItemError(item.id, null)
    setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: nextStatus } : f)))
    try {
      const res = await fetch(`/api/admin/feedback/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Não foi possível atualizar o feedback.')
      }
      // Atualiza o contador de não lidos da topbar.
      router.refresh()
    } catch (err) {
      setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: previous } : f)))
      setItemError(item.id, friendlyErrorMessage(err, 'Não foi possível atualizar o feedback. Tente novamente.'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {header}
        <div
          role="group"
          aria-label="Filtrar feedback"
          className="flex items-center gap-1 rounded-xl border border-[var(--navy-06)] bg-white p-1 shadow-[var(--shadow-sm)]"
        >
          {FILTERS.map(({ value, label }) => {
            const active = value === filter
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(value)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] ${
                  active ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {label}
                <span className={active ? 'text-white/70' : 'text-gray-400'}>{counts[value]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            {filter === 'new' ? 'Nenhum feedback não lido.' : 'Nenhum feedback encontrado.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {visible.map((item) => {
              const unread = item.status === 'new'
              return (
                <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-4">
                  <span
                    aria-hidden
                    className={`mt-3 size-1.5 shrink-0 rounded-full ${unread ? 'bg-[var(--cyan)]' : 'bg-transparent'}`}
                  />
                  {unread && <span className="sr-only">Não lido</span>}
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--navy-06)] text-xs text-gray-600"
                  >
                    {initialsFrom(item.authorName, item.authorEmail)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm whitespace-pre-wrap text-gray-900">{item.message}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {item.accountId ? (
                        <Link
                          href={`/admin/accounts/${item.accountId}`}
                          className="text-[var(--cyan-dark)] hover:underline"
                        >
                          {item.accountName ?? 'Cliente'}
                        </Link>
                      ) : (
                        'Sem cliente'
                      )}
                      {' · '}
                      {item.authorName ?? item.authorEmail ?? 'Usuário removido'}
                      {' · '}
                      {formatDateBR(item.createdAt)}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <ConvertToTaskButton
                        sourceType="feedback"
                        sourceRef={item.id}
                        title={taskTitleFrom(item.message)}
                        accountId={item.accountId}
                        initialTasked={item.tasked}
                      />
                      <Button size="sm" variant="ghost" onClick={() => toggleStatus(item)}>
                        {unread ? 'Marcar como lido' : 'Marcar como não lido'}
                      </Button>
                    </div>
                    {errors[item.id] && (
                      <p role="alert" className="max-w-64 text-right text-xs text-red-500">
                        {errors[item.id]}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
