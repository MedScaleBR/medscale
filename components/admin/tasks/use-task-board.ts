'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AccountTaskStatus } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import {
  applyMove,
  endPosition,
  inboxTaskPayload,
  optimisticTaskFromInbox,
  replaceTask,
  taskFromRow,
  type BoardTask,
  type InboxCard,
  type PersonOption,
  type TaskRowLike,
} from './board-logic'

export interface AccountOption {
  id: string
  name: string
}

export interface TaskFormValues {
  title: string
  description: string
  dueDate: string
  accountId: string
  assignedTo: string
  status: AccountTaskStatus
}

const MOVE_ERROR = 'Não foi possível mover o cartão. Tente novamente.'
const SAVE_ERROR = 'Não foi possível salvar a tarefa. Tente novamente.'
const DELETE_ERROR = 'Não foi possível excluir a tarefa. Tente novamente.'

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().catch(() => null)
}

function errorFrom(data: Record<string, unknown> | null, fallback: string): string {
  return friendlyErrorMessage(typeof data?.error === 'string' ? data.error : null, fallback)
}

export function useTaskBoard({
  initialTasks,
  initialInbox,
  admins,
  accounts,
}: {
  initialTasks: BoardTask[]
  initialInbox: InboxCard[]
  admins: PersonOption[]
  accounts: AccountOption[]
}) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [inbox, setInbox] = useState(initialInbox)
  const [error, setError] = useState<string | null>(null)
  // Leitura síncrona do estado atual dentro de callbacks assíncronos.
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const toTask = useCallback(
    (row: TaskRowLike, fallbackAccountName: string | null = null) =>
      taskFromRow(row, {
        accountName: row.account_id
          ? (accounts.find((a) => a.id === row.account_id)?.name ?? fallbackAccountName)
          : null,
        people: admins,
      }),
    [accounts, admins],
  )

  /** Move/reordena uma tarefa existente: otimista, PATCH, rollback em erro. */
  const moveTask = useCallback(
    async (taskId: string, status: AccountTaskStatus, position: number) => {
      const previous = tasksRef.current.find((t) => t.id === taskId)
      if (!previous || previous.saving) return
      if (previous.status === status && previous.position === position) return
      setError(null)
      setTasks((ts) => applyMove(ts, taskId, status, position, new Date().toISOString()))

      const restore = () => setTasks((ts) => ts.map((t) => (t.id === taskId ? previous : t)))
      try {
        const res = await fetch(`/api/admin/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, position }),
        })
        const data = await readJson(res)
        if (!res.ok) {
          restore()
          setError(errorFrom(data, MOVE_ERROR))
          return
        }
        if (data) {
          const saved = toTask(data as unknown as TaskRowLike, previous.accountName)
          setTasks((ts) => ts.map((t) => (t.id === taskId ? saved : t)))
        }
        // Mudar de coluna mexe nos contadores da topbar (vencidas, feedback).
        if (previous.status !== status) router.refresh()
      } catch {
        restore()
        setError(MOVE_ERROR)
      }
    },
    [router, toTask],
  )

  /** Tira um cartão da Entrada: vira tarefa na coluna de destino (POST idempotente). */
  const convertInbox = useCallback(
    async (card: InboxCard, status: AccountTaskStatus, position?: number) => {
      const pos = position ?? endPosition(tasksRef.current, status)
      const temp = optimisticTaskFromInbox(card, status, pos, new Date().toISOString())
      setError(null)
      setInbox((cards) => cards.filter((c) => c.id !== card.id))
      setTasks((ts) => [...ts, temp])

      const rollback = (message: string) => {
        setTasks((ts) => ts.filter((t) => t.id !== temp.id))
        setInbox((cards) => (cards.some((c) => c.id === card.id) ? cards : [...cards, card]))
        setError(message)
      }
      try {
        const res = await fetch('/api/admin/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inboxTaskPayload(card, status, pos)),
        })
        const data = await readJson(res)
        // 201 = criada; 200 = já existia tarefa para esta origem — as duas valem.
        if (!res.ok || !data) {
          rollback(errorFrom(data, SAVE_ERROR))
          return
        }
        const saved = toTask(data as unknown as TaskRowLike, card.accountName)
        setTasks((ts) => replaceTask(ts, temp.id, saved))
        router.refresh()
      } catch {
        rollback(SAVE_ERROR)
      }
    },
    [router, toTask],
  )

  /** Cria pelo diálogo. Devolve a mensagem de erro (ou null). */
  const createTask = useCallback(
    async (values: TaskFormValues): Promise<string | null> => {
      try {
        const res = await fetch('/api/admin/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: values.title.trim(),
            description: values.description.trim() || undefined,
            due_date: values.dueDate || undefined,
            assigned_to: values.assignedTo || undefined,
            account_id: values.accountId || undefined,
            status: values.status,
            position: endPosition(tasksRef.current, values.status),
          }),
        })
        const data = await readJson(res)
        if (!res.ok || !data) return errorFrom(data, SAVE_ERROR)
        const saved = toTask(data as unknown as TaskRowLike)
        setTasks((ts) => [...ts.filter((t) => t.id !== saved.id), saved])
        router.refresh()
        return null
      } catch {
        return SAVE_ERROR
      }
    },
    [router, toTask],
  )

  /** Edita pelo diálogo (campos aceitos pelo PATCH). */
  const updateTask = useCallback(
    async (task: BoardTask, values: TaskFormValues): Promise<string | null> => {
      try {
        const res = await fetch(`/api/admin/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: values.title.trim(),
            description: values.description.trim() || null,
            due_date: values.dueDate || null,
            assigned_to: values.assignedTo || null,
          }),
        })
        const data = await readJson(res)
        if (!res.ok || !data) return errorFrom(data, SAVE_ERROR)
        const saved = toTask(data as unknown as TaskRowLike, task.accountName)
        setTasks((ts) => ts.map((t) => (t.id === task.id ? saved : t)))
        if (saved.dueDate !== task.dueDate) router.refresh()
        return null
      } catch {
        return SAVE_ERROR
      }
    },
    [router, toTask],
  )

  /** Exclui: otimista, rollback em erro. */
  const deleteTask = useCallback(
    async (task: BoardTask) => {
      setError(null)
      setTasks((ts) => ts.filter((t) => t.id !== task.id))
      const restore = (message: string) => {
        setTasks((ts) => (ts.some((t) => t.id === task.id) ? ts : [...ts, task]))
        setError(message)
      }
      try {
        const res = await fetch(`/api/admin/tasks/${task.id}`, { method: 'DELETE' })
        if (!res.ok) {
          restore(errorFrom(await readJson(res), DELETE_ERROR))
          return
        }
        router.refresh()
      } catch {
        restore(DELETE_ERROR)
      }
    },
    [router],
  )

  /** Liga/desliga concluída (modo lista): vai para o fim da coluna de destino. */
  const toggleDone = useCallback(
    (task: BoardTask) => {
      const status: AccountTaskStatus = task.status === 'done' ? 'todo' : 'done'
      const others = tasksRef.current.filter((t) => t.id !== task.id)
      return moveTask(task.id, status, endPosition(others, status))
    },
    [moveTask],
  )

  return {
    tasks,
    inbox,
    error,
    setError,
    moveTask,
    convertInbox,
    createTask,
    updateTask,
    deleteTask,
    toggleDone,
  }
}
