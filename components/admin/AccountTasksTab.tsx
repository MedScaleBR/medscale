'use client'

import { useMemo, useState } from 'react'
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

function isOverdue(dueDate: string | null, status: AccountTaskStatus) {
  if (!dueDate || status === 'done') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

export function AccountTasksTab({
  accountId,
  initialTasks,
  admins,
}: {
  accountId: string
  initialTasks: TaskRow[]
  admins: AdminOption[]
}) {
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
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (task: TaskRow) => {
    const nextStatus: AccountTaskStatus = task.status === 'pending' ? 'done' : 'pending'
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    await fetch(`/api/admin/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
  }

  const removeTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    await fetch(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
  }

  const pending = tasks
    .filter((t) => t.status === 'pending')
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
          <Switch checked={task.status === 'done'} onCheckedChange={() => toggleStatus(task)} />
        </div>
        <div>
          <p className={cn('text-sm font-medium', task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900')}>
            {task.title}
          </p>
          {task.description && <p className="mt-0.5 text-xs text-gray-400">{task.description}</p>}
          <p className="mt-1 flex items-center gap-2 text-xs">
            {task.dueDate && (
              <span className={isOverdue(task.dueDate, task.status) ? 'font-medium text-red-500' : 'text-gray-400'}>
                {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR')}
              </span>
            )}
            {task.assigneeName && <span className="text-gray-400">· {task.assigneeName}</span>}
          </p>
        </div>
      </div>
      <button onClick={() => removeTask(task.id)} className="text-gray-300 hover:text-red-500">
        <X className="h-4 w-4" />
      </button>
    </li>
  )

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
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
            className="h-9 rounded-lg border border-gray-200 px-2.5 text-sm outline-none focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
          />
          <Select
            items={assigneeItems}
            value={assignedTo || 'none'}
            onValueChange={(v) => setAssignedTo(!v || v === 'none' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-44 text-xs">
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
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Criar tarefa'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
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
