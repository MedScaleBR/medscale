'use client'

import type { CSSProperties, KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/finance/summary'
import { formatDateBR, initialsFrom } from '@/lib/admin/format'
import { saoPauloDate } from '@/lib/admin/queue'
import type { AccountTaskSourceType } from '@/types/database'
import { isTaskOverdue, shortDate, type BoardItem } from './board-logic'

const KIND_BADGE: Record<'task' | AccountTaskSourceType, { label: string; className: string }> = {
  task: { label: 'Tarefa', className: 'bg-[var(--navy-06)] text-gray-500' },
  cost_alert: { label: 'Alerta', className: 'border border-amber-200 bg-amber-50 text-amber-900' },
  feedback: { label: 'Feedback', className: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]' },
}

const SOURCE_LABEL: Record<AccountTaskSourceType, string> = {
  cost_alert: 'Custos',
  feedback: 'Feedback',
}

function KindBadge({ kind }: { kind: 'task' | AccountTaskSourceType }) {
  const badge = KIND_BADGE[kind]
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] leading-none whitespace-nowrap',
        badge.className,
      )}
    >
      {badge.label}
    </span>
  )
}

function ageLabel(days: number): string {
  if (days <= 0) return 'hoje'
  if (days === 1) return 'há 1 dia'
  return `há ${days} dias`
}

/** Canto superior direito: prazo, data de conclusão, custo ou idade. */
function CornerInfo({ item, today }: { item: BoardItem; today: string }) {
  if (item.type === 'inbox') {
    const { card } = item
    const text = card.sourceType === 'cost_alert' && card.cost != null ? formatBRL(card.cost) : ageLabel(card.age)
    return <span className="text-xs whitespace-nowrap text-gray-400">{text}</span>
  }
  const { task } = item
  if (task.status === 'done') {
    if (!task.completedAt) return null
    const day = saoPauloDate(task.completedAt)
    return (
      <span className="text-xs whitespace-nowrap text-gray-400" title={`Concluída em ${formatDateBR(day)}`}>
        {shortDate(day)}
      </span>
    )
  }
  if (!task.dueDate) return null
  const overdue = isTaskOverdue(task, today)
  return (
    <span
      className={cn('text-xs whitespace-nowrap', overdue ? 'font-medium text-red-500' : 'text-gray-400')}
      title={`${overdue ? 'Vencida em' : 'Prazo'} ${formatDateBR(task.dueDate)}`}
    >
      {overdue ? `Venc. ${shortDate(task.dueDate)}` : shortDate(task.dueDate)}
    </span>
  )
}

export function cardTitle(item: BoardItem): string {
  return item.type === 'task' ? item.task.title : item.card.title
}

/** Conteúdo visual do cartão (no quadro e no DragOverlay). */
export function TaskCardBody({ item, today }: { item: BoardItem; today: string }) {
  const done = item.type === 'task' && item.task.status === 'done'
  const kind = item.type === 'task' ? (item.task.sourceType ?? 'task') : item.card.sourceType
  const source = item.type === 'task' ? item.task.sourceType : item.card.sourceType
  // Alerta de custo na Entrada: o canto mostra o valor, então a idade vai no rodapé ("Custos · hoje").
  const footer = !source
    ? ''
    : item.type === 'inbox' && source === 'cost_alert'
      ? `${SOURCE_LABEL[source]} · ${ageLabel(item.card.age)}`
      : SOURCE_LABEL[source]
  const accountName = item.type === 'task' ? (item.task.accountName ?? 'Interna') : (item.card.accountName ?? 'Sem cliente')
  const assignee =
    item.type === 'task' && item.task.assignedTo
      ? { name: item.task.assigneeName, email: item.task.assigneeEmail }
      : null

  return (
    <div className={cn('flex flex-col gap-2', done && 'opacity-70')}>
      <div className="flex items-center justify-between gap-2">
        <KindBadge kind={kind} />
        <CornerInfo item={item} today={today} />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            'line-clamp-3 text-sm break-words',
            done ? 'text-gray-400 line-through' : 'text-gray-900',
          )}
        >
          {cardTitle(item)}
        </p>
        <p className="mt-1 truncate text-xs text-gray-400">{accountName}</p>
      </div>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs whitespace-nowrap text-gray-400">{footer}</span>
        {assignee && (
          <span
            title={assignee.name ?? assignee.email ?? undefined}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--navy-06)] text-[10px] text-gray-600"
          >
            {initialsFrom(assignee.name, assignee.email)}
          </span>
        )}
      </div>
    </div>
  )
}

export const CARD_CLASS =
  'rounded-[10px] border border-[var(--navy-06)] bg-white p-3 shadow-[var(--shadow-sm)]'

/** Cartão arrastável. O botão "Virar tarefa" fica fora do elemento arrastável (sem interativo aninhado). */
export function SortableTaskCard({
  item,
  today,
  dropDisabled = false,
  onOpen,
  onConvert,
}: {
  item: BoardItem
  today: string
  /** Não aceita cartões soltos sobre ele (cartões da Entrada durante arraste de tarefa). */
  dropDisabled?: boolean
  onOpen?: () => void
  onConvert?: () => void
}) {
  const saving = item.type === 'task' && !!item.task.saving
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { column: item.column, title: cardTitle(item) },
    disabled: { draggable: saving, droppable: dropDisabled },
  })

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Espaço pega/solta o cartão (sensor de teclado); Enter abre a tarefa.
    if (e.key === 'Enter' && !isDragging && onOpen) {
      e.preventDefault()
      onOpen()
      return
    }
    listeners?.onKeyDown?.(e)
  }

  return (
    <li ref={setNodeRef} style={style} className={cn('relative list-none', isDragging && 'opacity-40')}>
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-roledescription="cartão arrastável"
        aria-busy={saving || undefined}
        onKeyDown={onKeyDown}
        onClick={onOpen}
        className={cn(
          CARD_CLASS,
          'cursor-grab touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
          saving && 'cursor-progress opacity-60',
        )}
      >
        <TaskCardBody item={item} today={today} />
      </div>
      {onConvert && (
        <button
          type="button"
          onClick={onConvert}
          aria-label={`Virar tarefa: ${cardTitle(item)}`}
          title="Virar tarefa"
          className="absolute right-3 bottom-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navy-06)] text-gray-500 outline-none hover:bg-[var(--cyan-10)] hover:text-[var(--cyan-dark)] focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </li>
  )
}

/** Cópia que segue o ponteiro/teclado enquanto arrasta. */
export function DraggingCard({ item, today }: { item: BoardItem; today: string }) {
  return (
    <div className={cn(CARD_CLASS, 'rotate-[1.5deg] cursor-grabbing border-[var(--cyan)] shadow-[var(--shadow-md)]')}>
      <TaskCardBody item={item} today={today} />
    </div>
  )
}
