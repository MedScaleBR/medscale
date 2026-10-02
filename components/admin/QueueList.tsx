'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { QueueItem, QueueItemKind } from '@/lib/admin/queue'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const LIMIT = 10

type Tab = 'all' | QueueItemKind

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'task', label: 'Tarefas' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'alert', label: 'Alertas' },
]

function ageLabel(item: QueueItem): string {
  if (item.overdue) return `vencida há ${item.age} ${item.age === 1 ? 'dia' : 'dias'}`
  if (item.age <= 0) return 'hoje'
  if (item.age === 1) return 'ontem'
  return `há ${item.age} dias`
}

function KindBadge({ item }: { item: QueueItem }) {
  const styles: Record<QueueItemKind, string> = {
    task: item.overdue ? 'bg-red-50 text-red-600' : 'bg-[var(--navy-06)] text-gray-700',
    alert: 'border-amber-200 bg-amber-50 text-amber-900',
    feedback: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  }
  const labels: Record<QueueItemKind, string> = { task: 'Tarefa', alert: 'Alerta', feedback: 'Feedback' }
  return (
    <span
      className={cn(
        'inline-flex h-5 w-[68px] shrink-0 items-center justify-center rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap',
        styles[item.kind],
      )}
    >
      {labels[item.kind]}
    </span>
  )
}

export function QueueList({ items: initialItems, error: loadError = null }: { items: QueueItem[]; error?: string | null }) {
  const router = useRouter()
  // Concluídas some na hora; o resto continua vindo do servidor, então o
  // router.refresh() traz itens novos sem perder o que foi escondido.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const items = useMemo(() => initialItems.filter((i) => !hidden.has(i.id)), [initialItems, hidden])
  const [tab, setTab] = useState<Tab>('all')
  const [error, setError] = useState<{ id: string; message: string } | null>(null)

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: items.length, task: 0, alert: 0, feedback: 0 }
    for (const i of items) c[i.kind] += 1
    return c
  }, [items])

  const visible = (tab === 'all' ? items : items.filter((i) => i.kind === tab)).slice(0, LIMIT)

  async function complete(item: QueueItem) {
    setError(null)
    setHidden((prev) => new Set(prev).add(item.id))
    try {
      const res = await fetch(`/api/admin/tasks/${item.taskId ?? item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Não foi possível concluir a tarefa.')
      }
      router.refresh()
    } catch (err) {
      setHidden((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      setError({
        id: item.id,
        message: friendlyErrorMessage(err, 'Não foi possível concluir a tarefa. Tente novamente.'),
      })
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
      <div role="group" aria-label="Filtrar fila" className="flex gap-1 overflow-x-auto border-b border-[var(--navy-06)] px-4 py-3">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.key)}
              className={cn(
                'h-8 rounded-[10px] px-3 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                active
                  ? 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]'
                  : 'text-gray-600 hover:bg-[var(--navy-06)] hover:text-gray-900',
              )}
            >
              {t.label} <span className={active ? 'text-[var(--cyan-dark)]' : 'text-gray-400'}>{counts[t.key]}</span>
            </button>
          )
        })}
      </div>

      {/* Erro em alguma consulta: a fila pode estar incompleta, nunca "vazia". */}
      {loadError && (
        <p role="alert" className={cn('px-5 text-xs text-red-500', visible.length === 0 ? 'py-10 text-center' : 'pt-3')}>
          Não foi possível carregar a fila.
        </p>
      )}
      {visible.length === 0 ? (
        !loadError && <p className="px-5 py-10 text-center text-sm text-gray-400">Nada pendente por aqui.</p>
      ) : (
        <ul className="divide-y divide-[var(--navy-06)]">
          {visible.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <KindBadge item={item} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900" title={item.kind === 'feedback' ? item.message : item.title}>
                    {item.kind === 'feedback' ? `“${item.title}”` : item.title}
                  </p>
                  {item.subtitle && <p className="truncate text-xs text-gray-400">{item.subtitle}</p>}
                </div>
                <span className={cn('shrink-0 text-xs whitespace-nowrap', item.overdue ? 'text-red-500' : 'text-gray-400')}>
                  {ageLabel(item)}
                </span>
                {item.kind === 'task' && (
                  <Button variant="outline" size="sm" onClick={() => complete(item)}>
                    Concluir
                  </Button>
                )}
                {item.kind === 'alert' && (
                  <Link href="/admin/costs" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    Investigar
                  </Link>
                )}
                {item.kind === 'feedback' && (
                  <Link href="/admin/feedback" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    Ler
                  </Link>
                )}
              </div>
              {error?.id === item.id && <p className="mt-1.5 text-xs text-red-500">{error.message}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end border-t border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-5 py-2.5">
        <Link
          href="/admin/tasks"
          className="rounded-[10px] text-xs text-[var(--cyan-dark)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
        >
          Ver todas
        </Link>
      </div>
    </div>
  )
}
