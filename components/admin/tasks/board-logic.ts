import type { AccountTaskSourceType, AccountTaskStatus } from '@/types/database'
import { daysBetween, isOverdue, saoPauloDate } from '@/lib/admin/queue'

// Lógica pura do quadro de tarefas: colunas, ordem, filtros e posição ao
// soltar um cartão. Sem React, para ser testável no vitest.

export type ColumnId = 'inbox' | AccountTaskStatus

export const COLUMN_IDS: readonly ColumnId[] = ['inbox', 'todo', 'doing', 'done']
export const TASK_STATUSES: readonly AccountTaskStatus[] = ['todo', 'doing', 'done']

export const COLUMN_LABELS: Record<ColumnId, string> = {
  inbox: 'Entrada',
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluídas',
}

/** Distância entre posições quando o cartão vai para uma das pontas. */
export const POSITION_STEP = 1024
/** Concluídas mostra só o que foi concluído nestes últimos dias. */
export const RECENT_DONE_DAYS = 7
/** Título de tarefa criada a partir de feedback: a mensagem inteira vai na descrição. */
export const MAX_TASK_TITLE = 140

export interface BoardTask {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  status: AccountTaskStatus
  position: number
  accountId: string | null
  accountName: string | null
  assignedTo: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  sourceType: AccountTaskSourceType | null
  sourceRef: string | null
  completedAt: string | null
  createdAt: string
  /** Criada de forma otimista e ainda sem resposta do servidor. */
  saving?: boolean
}

/** Alerta de custo ou feedback ainda sem tarefa (vem de getAdminQueue). */
export interface InboxCard {
  /** Id no quadro: `entrada:<ref>` — não colide com o id de tarefa. */
  id: string
  ref: string
  sourceType: AccountTaskSourceType
  title: string
  /** Texto completo (feedback) ou frase com os números (alerta). */
  detail: string | null
  accountId: string | null
  accountName: string | null
  /** Dias desde a criação (feedback). Alerta: 0. */
  age: number
  /** Só alertas, em reais. */
  cost: number | null
  /** Ordem original da fila, para devolver o cartão ao lugar no rollback. */
  order: number
}

export type BoardItem =
  | { type: 'task'; id: string; column: ColumnId; task: BoardTask }
  | { type: 'inbox'; id: string; column: ColumnId; card: InboxCard }

export type BoardColumns = Record<ColumnId, BoardItem[]>

export interface BoardFilters {
  query: string
  /** 'mine' = só cartões do usuário logado. */
  assignee: 'all' | 'mine'
  overdueOnly: boolean
  /** 'all', 'none' (sem cliente) ou id da account. */
  account: string
}

export const DEFAULT_FILTERS: BoardFilters = { query: '', assignee: 'all', overdueOnly: false, account: 'all' }

export interface BoardContext {
  /** YYYY-MM-DD em São Paulo. */
  today: string
  userId: string | null
}

export const inboxId = (ref: string) => `entrada:${ref}`

export function isColumnId(id: unknown): id is ColumnId {
  return typeof id === 'string' && (COLUMN_IDS as readonly string[]).includes(id)
}

// ============================================================
// Ordem e posição
// ============================================================

/** Posição entre dois vizinhos; ±POSITION_STEP nas pontas; 0 em coluna vazia. */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before)
  const hasAfter = typeof after === 'number' && Number.isFinite(after)
  if (hasBefore && hasAfter) return (before + after) / 2
  if (hasBefore) return before + POSITION_STEP
  if (hasAfter) return after - POSITION_STEP
  return 0
}

/** position, depois prazo (sem prazo por último), depois criação. */
export function compareTasks(a: BoardTask, b: BoardTask): number {
  if (a.position !== b.position) return a.position - b.position
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  return a.createdAt.localeCompare(b.createdAt)
}

/** Posição para acrescentar no fim de uma coluna. */
export function endPosition(tasks: BoardTask[], status: AccountTaskStatus): number {
  const inColumn = tasks.filter((t) => t.status === status)
  if (inColumn.length === 0) return 0
  return Math.max(...inColumn.map((t) => t.position)) + POSITION_STEP
}

/**
 * Posição do cartão `activeId` depois de solto em `items` (a coluna de
 * destino na ordem exibida, já com o cartão no lugar novo). Usa só os vizinhos
 * que são tarefas — o próprio cartão pode ser um cartão da Entrada.
 */
export function dropPosition(items: BoardItem[], activeId: string): number {
  const index = items.findIndex((i) => i.id === activeId)
  const neighbor = (i: number) => {
    const item = items[i]
    return item && item.type === 'task' ? item.task.position : null
  }
  if (index === -1) return positionBetween(neighbor(items.length - 1), null)
  return positionBetween(neighbor(index - 1), neighbor(index + 1))
}

// ============================================================
// Datas e filtros
// ============================================================

export function isTaskOverdue(task: Pick<BoardTask, 'dueDate' | 'status'>, today: string): boolean {
  return task.status !== 'done' && isOverdue(task.dueDate, today)
}

/** Concluída nos últimos RECENT_DONE_DAYS dias (hoje incluso), no fuso de São Paulo. */
export function isRecentlyDone(task: Pick<BoardTask, 'status' | 'completedAt'>, today: string): boolean {
  if (task.status !== 'done' || !task.completedAt) return false
  const age = daysBetween(saoPauloDate(task.completedAt), today)
  return age >= 0 && age < RECENT_DONE_DAYS
}

export function countOverdue(tasks: BoardTask[], today: string): number {
  return tasks.filter((t) => isTaskOverdue(t, today)).length
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function matchesQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const q = normalize(query)
  if (!q) return true
  return fields.some((f) => !!f && normalize(f).includes(q))
}

function matchesAccount(account: string, accountId: string | null): boolean {
  if (account === 'all') return true
  if (account === 'none') return !accountId
  return accountId === account
}

export function matchesTask(task: BoardTask, filters: BoardFilters, ctx: BoardContext): boolean {
  if (!matchesQuery(filters.query, [task.title, task.description, task.accountName ?? 'Interna'])) return false
  if (filters.assignee === 'mine' && (!ctx.userId || task.assignedTo !== ctx.userId)) return false
  if (filters.overdueOnly && !isTaskOverdue(task, ctx.today)) return false
  return matchesAccount(filters.account, task.accountId)
}

/** Cartão da Entrada não tem dono nem prazo: some com "Meus cartões" e "Só vencidos". */
export function matchesInbox(card: InboxCard, filters: BoardFilters): boolean {
  if (filters.assignee === 'mine' || filters.overdueOnly) return false
  if (!matchesQuery(filters.query, [card.title, card.detail, card.accountName])) return false
  return matchesAccount(filters.account, card.accountId)
}

// ============================================================
// Colunas
// ============================================================

export function buildColumns(
  tasks: BoardTask[],
  inbox: InboxCard[],
  filters: BoardFilters,
  ctx: BoardContext,
): BoardColumns {
  const columns: BoardColumns = { inbox: [], todo: [], doing: [], done: [] }

  for (const card of [...inbox].sort((a, b) => a.order - b.order)) {
    if (matchesInbox(card, filters)) columns.inbox.push({ type: 'inbox', id: card.id, column: 'inbox', card })
  }

  for (const task of [...tasks].sort(compareTasks)) {
    if (task.status === 'done' && !isRecentlyDone(task, ctx.today)) continue
    if (!matchesTask(task, filters, ctx)) continue
    columns[task.status].push({ type: 'task', id: task.id, column: task.status, task })
  }

  return columns
}

export function findColumn(columns: BoardColumns, id: string): ColumnId | null {
  if (isColumnId(id)) return id
  for (const column of COLUMN_IDS) {
    if (columns[column].some((i) => i.id === id)) return column
  }
  return null
}

/** Entrada não recebe cartões; só o próprio cartão da Entrada pode voltar para ela. */
export function canDropInto(from: ColumnId, to: ColumnId): boolean {
  return to !== 'inbox' || from === 'inbox'
}

/**
 * Tira `activeId` da coluna onde está e insere em `to` na posição `index`
 * (limitada ao tamanho da coluna). Usado na pré-visualização do arraste.
 */
export function relocate(columns: BoardColumns, activeId: string, to: ColumnId, index: number): BoardColumns {
  const from = findColumn(columns, activeId)
  if (!from) return columns
  const item = columns[from].find((i) => i.id === activeId)!
  const next: BoardColumns = { ...columns, [from]: columns[from].filter((i) => i.id !== activeId) }
  const target = [...next[to]]
  const at = Math.max(0, Math.min(index, target.length))
  target.splice(at, 0, { ...item, column: to })
  next[to] = target
  return next
}

/** Move dentro da mesma coluna (equivalente ao arrayMove do dnd-kit). */
export function reorderWithin(items: BoardItem[], activeId: string, overId: string): BoardItem[] {
  const from = items.findIndex((i) => i.id === activeId)
  const to = items.findIndex((i) => i.id === overId)
  if (from === -1 || to === -1 || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// ============================================================
// Mutações locais
// ============================================================

/** Aplica status + position; completed_at segue a regra da API. */
export function applyMove(
  tasks: BoardTask[],
  taskId: string,
  status: AccountTaskStatus,
  position: number,
  nowIso: string,
): BoardTask[] {
  return tasks.map((t) => {
    if (t.id !== taskId) return t
    const completedAt = status === 'done' ? (t.status === 'done' ? t.completedAt : nowIso) : null
    return { ...t, status, position, completedAt }
  })
}

export function truncateTitle(text: string, max = MAX_TASK_TITLE): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/** Corpo do POST /api/admin/tasks para tirar um cartão da Entrada. */
export function inboxTaskPayload(card: InboxCard, status: AccountTaskStatus, position: number) {
  const title = truncateTitle(card.title)
  const description = card.sourceType === 'feedback' && card.detail && card.detail.trim() !== title ? card.detail : null
  return {
    title,
    description,
    account_id: card.accountId,
    status,
    position,
    source_type: card.sourceType,
    source_ref: card.ref,
  }
}

/** Tarefa otimista enquanto o POST da Entrada não volta. */
export function optimisticTaskFromInbox(
  card: InboxCard,
  status: AccountTaskStatus,
  position: number,
  nowIso: string,
): BoardTask {
  const payload = inboxTaskPayload(card, status, position)
  return {
    id: `tmp:${card.ref}`,
    title: payload.title,
    description: payload.description,
    dueDate: null,
    status,
    position,
    accountId: card.accountId,
    accountName: card.accountName,
    assignedTo: null,
    assigneeName: null,
    assigneeEmail: null,
    sourceType: card.sourceType,
    sourceRef: card.ref,
    completedAt: status === 'done' ? nowIso : null,
    createdAt: nowIso,
    saving: true,
  }
}

export interface TaskRowLike {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: AccountTaskStatus
  position: number | null
  account_id: string | null
  assigned_to: string | null
  source_type: AccountTaskSourceType | null
  source_ref: string | null
  completed_at: string | null
  created_at: string
}

export interface PersonOption {
  id: string
  name: string | null
  email: string | null
}

export function personLabel(p: Pick<PersonOption, 'name' | 'email'>): string {
  return p.name?.trim() || p.email || 'Admin'
}

/** Linha do banco/API → tarefa do quadro. */
export function taskFromRow(
  row: TaskRowLike,
  lookup: { accountName: string | null; people: PersonOption[] },
): BoardTask {
  const person = row.assigned_to ? lookup.people.find((p) => p.id === row.assigned_to) : undefined
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    position: row.position ?? 0,
    accountId: row.account_id,
    accountName: lookup.accountName,
    assignedTo: row.assigned_to,
    assigneeName: person?.name ?? null,
    assigneeEmail: person?.email ?? null,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

/** Troca a tarefa otimista pela devolvida (201) ou pela já existente (200). */
export function replaceTask(tasks: BoardTask[], tempId: string, saved: BoardTask): BoardTask[] {
  const rest = tasks.filter((t) => t.id !== tempId && t.id !== saved.id)
  return [...rest, saved]
}

// ============================================================
// Modo lista
// ============================================================

export type ListStatusFilter = 'open' | 'done' | 'all'

/** Mesma regra do antigo GlobalTasksList: filtra e ordena por prazo (sem prazo no fim). */
export function listTasks(
  tasks: BoardTask[],
  filters: BoardFilters,
  status: ListStatusFilter,
  ctx: BoardContext,
): BoardTask[] {
  return tasks
    .filter((t) => {
      if (status === 'open' && t.status === 'done') return false
      if (status === 'done' && t.status !== 'done') return false
      return matchesTask(t, filters, ctx)
    })
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      }
      return compareTasks(a, b)
    })
}

/** dd/MM de uma data pura (YYYY-MM-DD) — cartões compactos. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}
