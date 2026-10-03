'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  COLUMN_IDS,
  COLUMN_LABELS,
  DEFAULT_FILTERS,
  buildColumns,
  canDropInto,
  countOverdue,
  dropPosition,
  findColumn,
  isColumnId,
  listTasks,
  relocate,
  reorderWithin,
  type BoardColumns,
  type BoardFilters,
  type BoardItem,
  type BoardTask,
  type ColumnId,
  type InboxCard,
  type ListStatusFilter,
  type PersonOption,
} from './board-logic'
import { TaskColumn } from './TaskColumn'
import { DraggingCard } from './TaskCard'
import { TaskDialog, type TaskDialogMode } from './TaskDialog'
import { TaskListView } from './TaskListView'
import { useTaskBoard, type AccountOption } from './use-task-board'

type View = 'board' | 'list'

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Para mover um cartão, pressione espaço para pegá-lo. Use as setas para trocar de posição ou de coluna e pressione espaço de novo para soltar, ou Esc para cancelar. Enter abre a tarefa.',
}

const CHIP_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--cyan)] active:translate-y-px'
const CHIP_ON = 'border-[var(--navy-dark)] bg-[var(--navy-dark)] text-white'
const CHIP_OFF = 'border-[var(--navy-10)] bg-white text-gray-600 hover:text-gray-900'

interface DialogState {
  open: boolean
  key: number
  mode: TaskDialogMode
}

export function TaskBoard({
  initialTasks,
  initialInbox,
  admins,
  accounts,
  currentUserId,
  today,
}: {
  initialTasks: BoardTask[]
  initialInbox: InboxCard[]
  admins: PersonOption[]
  accounts: AccountOption[]
  currentUserId: string | null
  /** YYYY-MM-DD em São Paulo, calculado no servidor (evita divergência na hidratação). */
  today: string
}) {
  const board = useTaskBoard({ initialTasks, initialInbox, admins, accounts })
  const { tasks, inbox, error, moveTask, convertInbox } = board

  const [view, setView] = useState<View>('board')
  const [listStatus, setListStatus] = useState<ListStatusFilter>('open')
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [dialog, setDialog] = useState<DialogState>({ open: false, key: 0, mode: { kind: 'create', status: 'todo' } })

  const ctx = useMemo(() => ({ today, userId: currentUserId }), [today, currentUserId])
  const overdueCount = useMemo(() => countOverdue(tasks, today), [tasks, today])
  const baseColumns = useMemo(() => buildColumns(tasks, inbox, filters, ctx), [tasks, inbox, filters, ctx])
  const listed = useMemo(() => listTasks(tasks, filters, listStatus, ctx), [tasks, filters, listStatus, ctx])

  // ---------------------------------------------------------- arraste
  const [active, setActive] = useState<BoardItem | null>(null)
  const [preview, setPreview] = useState<{ to: ColumnId; index: number } | null>(null)
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null)

  const columns: BoardColumns = useMemo(
    () => (active && preview ? relocate(baseColumns, active.id, preview.to, preview.index) : baseColumns),
    [active, preview, baseColumns],
  )

  // Callbacks do dnd-kit (colisão, anúncios) leem o estado mais recente por ref.
  const columnsRef = useRef(columns)
  const activeRef = useRef(active)
  useEffect(() => {
    columnsRef.current = columns
    activeRef.current = active
  }, [columns, active])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter fica livre para abrir a tarefa.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const origin = activeRef.current?.column ?? 'todo'
    const allowed = args.droppableContainers.filter((c) => {
      const column = c.data.current?.column
      return !isColumnId(column) || canDropInto(origin, column)
    })
    const scoped = { ...args, droppableContainers: allowed }
    const pointer = pointerWithin(scoped)
    const hits = pointer.length > 0 ? pointer : closestCorners(scoped)
    const first = hits[0]
    if (!first) return []
    // Sobre a coluna (e não sobre um cartão): mira o cartão mais próximo dela.
    if (isColumnId(first.id)) {
      const ids = new Set(columnsRef.current[first.id].map((i) => i.id))
      const inner = allowed.filter((c) => ids.has(String(c.id)))
      if (inner.length > 0) {
        const closest = closestCenter({ ...scoped, droppableContainers: inner })
        if (closest.length > 0) return closest
      }
    }
    return hits
  }, [])

  const resetDrag = () => {
    setActive(null)
    setPreview(null)
    setOverColumn(null)
  }

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const id = String(a.id)
    const column = findColumn(baseColumns, id)
    const item = column ? baseColumns[column].find((i) => i.id === id) : undefined
    board.setError(null)
    setActive(item ?? null)
    setPreview(null)
  }

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!active || !over) {
      setOverColumn(null)
      return
    }
    const activeId = String(a.id)
    const overId = String(over.id)
    const to = findColumn(columns, overId)
    setOverColumn(to)
    const current = findColumn(columns, activeId)
    if (!to || !current || to === current || !canDropInto(active.column, to)) return
    if (to === active.column) {
      // Voltou para a coluna de origem: a ordem dentro dela é com o sortable.
      setPreview(null)
      return
    }
    let index = columns[to].length
    if (!isColumnId(overId)) {
      const overIndex = columns[to].findIndex((i) => i.id === overId)
      const translated = a.rect.current.translated
      const below = !!translated && translated.top > over.rect.top + over.rect.height / 2
      index = overIndex + (below ? 1 : 0)
    }
    setPreview({ to, index })
  }

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const item = active
    const snapshot = columns
    resetDrag()
    if (!item || !over) return

    const activeId = String(a.id)
    const overId = String(over.id)
    const to = findColumn(snapshot, overId)
    if (!to || to === 'inbox' || !canDropInto(item.column, to)) return

    let list = snapshot[to]
    if (!isColumnId(overId) && overId !== activeId && findColumn(snapshot, activeId) === to) {
      list = reorderWithin(list, activeId, overId)
    }

    if (item.type === 'inbox') {
      void convertInbox(item.card, to, dropPosition(list, activeId))
      return
    }

    // Mesma coluna e mesma posição: nada a salvar.
    const originalIndex = baseColumns[item.column].findIndex((i) => i.id === activeId)
    if (to === item.column && list.findIndex((i) => i.id === activeId) === originalIndex) return
    void moveTask(item.task.id, to, dropPosition(list, activeId))
  }

  const describePosition = (id: UniqueIdentifier) => {
    const column = findColumn(columnsRef.current, String(id))
    if (!column) return null
    const items = columnsRef.current[column]
    const index = items.findIndex((i) => i.id === String(id))
    const label = COLUMN_LABELS[column]
    if (index === -1) return `na coluna ${label}`
    return `na coluna ${label}, posição ${index + 1} de ${items.length}`
  }

  const titleOf = (data: Record<string, unknown> | undefined) =>
    typeof data?.title === 'string' ? `“${data.title}”` : 'o cartão'

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Você pegou ${titleOf(a.data.current)} ${describePosition(a.id) ?? ''}.`,
    onDragOver: ({ active: a, over }) => {
      if (!over) return `${titleOf(a.data.current)} está fora das colunas.`
      return `${titleOf(a.data.current)} está ${describePosition(over.id) ?? 'fora das colunas'}.`
    },
    onDragEnd: ({ active: a, over }) => {
      if (!over) return `${titleOf(a.data.current)} foi solto fora das colunas. Nada mudou.`
      return `${titleOf(a.data.current)} foi solto ${describePosition(over.id) ?? 'fora das colunas'}.`
    },
    onDragCancel: ({ active: a }) => {
      const origin = a.data.current?.column
      const label = isColumnId(origin) ? ` para ${COLUMN_LABELS[origin]}` : ''
      return `Movimento cancelado. ${titleOf(a.data.current)} voltou${label}.`
    },
  }

  // ---------------------------------------------------------- diálogo
  const openCreate = (status: 'todo' | 'doing' = 'todo') =>
    setDialog((d) => ({ open: true, key: d.key + 1, mode: { kind: 'create', status } }))

  const openTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.saving) return
    setDialog((d) => ({ open: true, key: d.key + 1, mode: { kind: 'edit', task } }))
  }

  const accountItems = useMemo(
    () => ({
      all: 'Cliente: todos',
      none: 'Cliente: interna',
      ...Object.fromEntries(accounts.map((a) => [a.id, `Cliente: ${a.name}`])),
    }),
    [accounts],
  )

  const setFilter = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Tarefas</h1>
          <p className="text-sm text-gray-400">Quadro de follow-ups, alertas e feedbacks de todas as accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <div
            role="radiogroup"
            aria-label="Modo de exibição"
            className="inline-flex rounded-[10px] border border-[var(--navy-06)] bg-white p-0.5"
          >
            {(
              [
                ['board', 'Quadro'],
                ['list', 'Lista'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                onClick={() => setView(value)}
                className={cn(
                  'h-8 rounded-[8px] px-3 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                  view === value ? 'bg-[var(--navy-dark)] text-white' : 'text-gray-500 hover:text-gray-900',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            onClick={() => openCreate('todo')}
            className="h-9 rounded-[10px] bg-[var(--cyan)] px-3 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus strokeWidth={2} aria-hidden="true" />
            Nova tarefa
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
            strokeWidth={2}
            aria-hidden="true"
          />
          <Input
            type="search"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            placeholder="Buscar tarefa ou cliente…"
            aria-label="Buscar tarefa ou cliente"
            className="h-9 rounded-[10px] bg-white pl-9"
          />
        </div>
        <button
          type="button"
          aria-pressed={filters.assignee === 'all'}
          onClick={() => setFilter('assignee', 'all')}
          className={cn(CHIP_CLASS, filters.assignee === 'all' ? CHIP_ON : CHIP_OFF)}
        >
          Todos os responsáveis
        </button>
        <button
          type="button"
          aria-pressed={filters.assignee === 'mine'}
          onClick={() => setFilter('assignee', filters.assignee === 'mine' ? 'all' : 'mine')}
          disabled={!currentUserId}
          className={cn(CHIP_CLASS, filters.assignee === 'mine' ? CHIP_ON : CHIP_OFF)}
        >
          Meus cartões
        </button>
        <button
          type="button"
          aria-pressed={filters.overdueOnly}
          onClick={() => setFilter('overdueOnly', !filters.overdueOnly)}
          className={cn(CHIP_CLASS, filters.overdueOnly ? CHIP_ON : CHIP_OFF)}
        >
          Só vencidos
          {overdueCount > 0 && <span className="whitespace-nowrap">{overdueCount}</span>}
        </button>
        <Select
          items={accountItems}
          value={filters.account}
          onValueChange={(v) => v && setFilter('account', String(v))}
        >
          <SelectTrigger
            aria-label="Filtrar por cliente"
            className={cn(CHIP_CLASS, 'max-w-60 data-[size=default]:h-9', filters.account !== 'all' ? CHIP_ON : CHIP_OFF)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            <SelectItem value="none">Interna (sem cliente)</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      {view === 'board' ? (
        <DndContext
          id="admin-task-board"
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={resetDrag}
          accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
        >
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-4">
            {COLUMN_IDS.map((column) => (
              <TaskColumn
                key={column}
                column={column}
                items={columns[column]}
                today={today}
                dropDisabled={!!active && !canDropInto(active.column, column)}
                isTarget={!!active && overColumn === column && canDropInto(active.column, column)}
                onOpenTask={openTask}
                onConvert={(item) => item.type === 'inbox' && void convertInbox(item.card, 'todo')}
                onAdd={column === 'todo' || column === 'doing' ? () => openCreate(column) : undefined}
                onShowAllDone={
                  column === 'done'
                    ? () => {
                        setListStatus('done')
                        setView('list')
                      }
                    : undefined
                }
              />
            ))}
          </div>
          <DragOverlay>{active ? <DraggingCard item={active} today={today} /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <TaskListView
          tasks={listed}
          status={listStatus}
          onStatusChange={setListStatus}
          today={today}
          onToggleDone={(task) => void board.toggleDone(task)}
          onOpen={(task) => openTask(task.id)}
          onDelete={(task) => void board.deleteTask(task)}
        />
      )}

      <TaskDialog
        key={dialog.key}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        mode={dialog.mode}
        admins={admins}
        accounts={accounts}
        onCreate={board.createTask}
        onUpdate={board.updateTask}
        onDelete={(task) => void board.deleteTask(task)}
      />
    </div>
  )
}
