'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COLUMN_LABELS, type BoardItem, type ColumnId } from './board-logic'
import { SortableTaskCard } from './TaskCard'

const DOT_CLASS: Record<ColumnId, string> = {
  inbox: 'bg-amber-500',
  todo: 'bg-gray-400',
  doing: 'bg-[var(--cyan)]',
  done: 'bg-green-600',
}

const NOTE: Partial<Record<ColumnId, string>> = {
  inbox: 'Sem dono · triagem',
  done: 'últimos 7 dias',
}

const EMPTY: Record<ColumnId, string> = {
  inbox: 'Nada para triar.',
  todo: 'Nenhuma tarefa.',
  doing: 'Nenhuma tarefa.',
  done: 'Nada concluído nos últimos 7 dias.',
}

export function TaskColumn({
  column,
  items,
  today,
  dropDisabled,
  isTarget,
  onOpenTask,
  onConvert,
  onAdd,
  onShowAllDone,
}: {
  column: ColumnId
  items: BoardItem[]
  today: string
  /** Arraste em curso que não pode cair aqui (tarefa sobre a Entrada). */
  dropDisabled: boolean
  /** Coluna sob o cartão arrastado. */
  isTarget: boolean
  onOpenTask: (taskId: string) => void
  onConvert: (item: BoardItem) => void
  onAdd?: () => void
  onShowAllDone?: () => void
}) {
  const { setNodeRef } = useDroppable({ id: column, data: { column }, disabled: dropDisabled })
  const headingId = `coluna-${column}`

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-w-0 flex-col rounded-[14px] bg-[var(--navy-06)] p-3 transition-colors',
        isTarget && 'ring-2 ring-[var(--cyan-30)]',
        dropDisabled && 'opacity-60',
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 id={headingId} className="flex items-center gap-2 text-sm font-medium whitespace-nowrap text-gray-900">
          <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', DOT_CLASS[column])} />
          {COLUMN_LABELS[column]}
          <span className="text-sm font-normal text-gray-400">{items.length}</span>
        </h2>
        {NOTE[column] && <span className="truncate text-xs text-gray-400">{NOTE[column]}</span>}
      </header>

      <SortableContext id={column} items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-16 flex-1 flex-col gap-2">
          {items.map((item) => (
            <SortableTaskCard
              key={item.id}
              item={item}
              today={today}
              dropDisabled={dropDisabled}
              onOpen={item.type === 'task' && !item.task.saving ? () => onOpenTask(item.task.id) : undefined}
              onConvert={item.type === 'inbox' && column === 'inbox' ? () => onConvert(item) : undefined}
            />
          ))}
          {items.length === 0 && (
            <li className="list-none rounded-[10px] border border-dashed border-[var(--navy-10)] px-3 py-6 text-center text-xs text-gray-400">
              {EMPTY[column]}
            </li>
          )}
        </ul>
      </SortableContext>

      {column === 'inbox' && items.length > 0 && (
        <p className="mt-3 px-1 text-xs text-gray-400">Arraste para outra coluna ou use “Virar tarefa”</p>
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 flex items-center gap-1 self-start rounded-[10px] px-1 text-xs text-gray-400 outline-none hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Adicionar tarefa
        </button>
      )}
      {onShowAllDone && (
        <button
          type="button"
          onClick={onShowAllDone}
          className="mt-3 self-start rounded-[10px] px-1 text-xs text-[var(--cyan-dark)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
        >
          Ver todas
        </button>
      )}
    </section>
  )
}
