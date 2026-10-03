'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatDateBR } from '@/lib/admin/format'
import { isTaskOverdue, type BoardTask, type ListStatusFilter } from './board-logic'

const STATUS_OPTIONS: { value: ListStatusFilter; label: string }[] = [
  { value: 'open', label: 'Pendentes' },
  { value: 'done', label: 'Concluídas' },
  { value: 'all', label: 'Todas' },
]

const STATUS_TEXT: Record<BoardTask['status'], string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
}

export function TaskListView({
  tasks,
  status,
  onStatusChange,
  today,
  onToggleDone,
  onOpen,
  onDelete,
}: {
  /** Já filtradas e ordenadas (listTasks). */
  tasks: BoardTask[]
  status: ListStatusFilter
  onStatusChange: (status: ListStatusFilter) => void
  today: string
  onToggleDone: (task: BoardTask) => void
  onOpen: (task: BoardTask) => void
  onDelete: (task: BoardTask) => void
}) {
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Situação das tarefas"
        className="inline-flex rounded-[10px] border border-[var(--navy-06)] bg-white p-0.5"
      >
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={status === o.value}
            onClick={() => onStatusChange(o.value)}
            className={cn(
              'h-8 rounded-[8px] px-3 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
              status === o.value ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {tasks.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma tarefa encontrada.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {tasks.map((task) => {
              const done = task.status === 'done'
              const overdue = isTaskOverdue(task, today)
              return (
                <li key={task.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5">
                      <Switch
                        checked={done}
                        disabled={task.saving}
                        onCheckedChange={() => onToggleDone(task)}
                        aria-label={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpen(task)}
                        disabled={task.saving}
                        className={cn(
                          'rounded text-left text-sm font-medium outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                          done ? 'text-gray-400 line-through' : 'text-gray-900',
                        )}
                      >
                        {task.title}
                      </button>
                      {task.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-400">{task.description}</p>
                      )}
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                        {task.accountId ? (
                          <Link
                            href={`/admin/accounts/${task.accountId}`}
                            className="rounded outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                          >
                            {task.accountName ?? 'Cliente'}
                          </Link>
                        ) : (
                          <span>Interna</span>
                        )}
                        <span className="whitespace-nowrap">· {STATUS_TEXT[task.status]}</span>
                        {task.dueDate && (
                          <span className={cn('whitespace-nowrap', overdue && 'font-medium text-red-500')}>
                            · {overdue ? 'Venceu em ' : ''}
                            {formatDateBR(task.dueDate)}
                          </span>
                        )}
                        {(task.assigneeName || task.assigneeEmail) && (
                          <span>· {task.assigneeName || task.assigneeEmail}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(task)}
                    disabled={task.saving}
                    aria-label={`Excluir ${task.title}`}
                    className="rounded text-gray-300 outline-none hover:text-red-500 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
