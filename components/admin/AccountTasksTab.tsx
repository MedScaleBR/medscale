'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { AccountTaskStatus } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { formatDateBR } from '@/lib/admin/format'
import { isOverdue } from '@/lib/admin/queue'

export interface TaskRow {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  status: AccountTaskStatus
  assignedTo: string | null
  assigneeName: string | null
}

export interface AdminOption {
  id: string
  name: string
}

export function AccountTasksTab({
  accountId,
  initialTasks,
  admins,
  today,
}: {
  accountId: string
  initialTasks: TaskRow[]
  admins: AdminOption[]
  /** YYYY-MM-DD em São Paulo, calculado no servidor (evita mismatch de hidratação). */
  today: string
}) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assigneeItems = useMemo(
    () => ({ none: 'Sem responsável', ...Object.fromEntries(admins.map((a) => [a.id, a.name])) }),
    [admins]
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          title,
          description: description || undefined,
          due_date: dueDate || undefined,
          assigned_to: assignedTo || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível criar a tarefa.')
        return
      }
      const assignee = admins.find((a) => a.id === data.assigned_to)
      setTasks((prev) => [
        {
          id: data.id,
          title: data.title,
          description: data.description,
          dueDate: data.due_date,
          status: data.status,
          assignedTo: data.assigned_to,
          assigneeName: assignee?.name ?? null,
        },
        ...prev,
      ])
      setTitle('')
      setDescription('')
      setDueDate('')
      setAssignedTo('')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  // Aberta = qualquer status diferente de 'done' (todo ou doing): concluir
  // leva a 'done'; reabrir uma concluída volta para 'todo'.
  const toggleStatus = async (task: TaskRow) => {
    const isOpen = task.status !== 'done'
    const nextStatus: AccountTaskStatus = isOpen ? 'done' : 'todo'
    const previous = tasks
    setError(null)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    try {
      const res = await fetch(`/api/admin/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setTasks(previous)
        setError(data.error ?? 'Não foi possível atualizar a tarefa.')
        return
      }
      router.refresh()
    } catch {
      setTasks(previous)
      setError('Não foi possível atualizar a tarefa.')
    }
  }

  const removeTask = async (taskId: string) => {
    const previous = tasks
    setError(null)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setTasks(previous)
        setError(data.error ?? 'Não foi possível remover a tarefa.')
        return
      }
      router.refresh()
    } catch {
      setTasks(previous)
      setError('Não foi possível remover a tarefa.')
    }
  }

  const pending = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
  const done = tasks.filter((t) => t.status === 'done')

  const renderTask = (task: TaskRow) => (
    <li key={task.id} className="flex items-start justify-between gap-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <Switch
            checked={task.status === 'done'}
            onCheckedChange={() => toggleStatus(task)}
            aria-label={task.status === 'done' ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
          />
        </div>
        <div>
          <p className={cn('text-sm font-medium', task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900')}>
            {task.title}
          </p>
          {task.description && <p className="mt-0.5 text-xs text-gray-400">{task.description}</p>}
          <p className="mt-1 flex items-center gap-2 text-xs">
            {task.dueDate && (
              <span
                className={
                  task.status !== 'done' && isOverdue(task.dueDate, today) ? 'font-medium text-red-500' : 'text-gray-400'
                }
              >
                {formatDateBR(task.dueDate)}
              </span>
            )}
            {task.assigneeName && <span className="text-gray-400">· {task.assigneeName}</span>}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => removeTask(task.id)}
        aria-label={`Remover tarefa ${task.title}`}
        className="rounded text-gray-300 outline-none hover:text-red-500 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Tarefas</h2>

      <form onSubmit={submit} className="mt-4 space-y-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da tarefa" className="h-9" />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição (opcional)"
          className="min-h-14"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Prazo"
            className="h-9 rounded-[10px] border border-gray-200 px-2.5 text-sm outline-none focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
          />
          <Select
            items={assigneeItems}
            value={assignedTo || 'none'}
            onValueChange={(v) => setAssignedTo(!v || v === 'none' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-44 text-xs" aria-label="Responsável">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem responsável</SelectItem>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            disabled={saving || !title.trim()}
            className="h-9 rounded-[10px] bg-[var(--cyan)] px-4 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Criar tarefa'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{friendlyErrorMessage(error, "Não foi possível salvar esta alteração. Tente novamente.")}</p>}
      </form>

      {pending.length === 0 && done.length === 0 ? (
        <p className="mt-6 text-sm text-gray-400">Nenhuma tarefa ainda.</p>
      ) : (
        <div className="mt-4 border-t border-[var(--navy-06)]">
          {pending.length > 0 && <ul className="divide-y divide-[var(--navy-06)]">{pending.map(renderTask)}</ul>}
          {done.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-2 text-xs text-gray-400">
                {done.length} tarefa{done.length > 1 ? 's' : ''} concluída{done.length > 1 ? 's' : ''}
              </summary>
              <ul className="divide-y divide-[var(--navy-06)]">{done.map(renderTask)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
