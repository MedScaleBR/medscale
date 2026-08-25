'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
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

export interface GlobalTaskRow {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  status: AccountTaskStatus
  accountId: string | null
  accountName: string | null
  assignedTo: string | null
  assigneeName: string | null
}

export interface AdminOption {
  id: string
  name: string
}

export interface AccountOption {
  id: string
  name: string
}

const STATUS_FILTER_ITEMS = {
  pending: 'Pendentes',
  done: 'Concluídas',
  all: 'Todas',
}

function isOverdue(dueDate: string | null, status: AccountTaskStatus) {
  if (!dueDate || status === 'done') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

export function GlobalTasksList({
  tasks: initialTasks,
  admins,
  accounts,
}: {
  tasks: GlobalTaskRow[]
  admins: AdminOption[]
  accounts: AccountOption[]
}) {
  const [tasks, setTasks] = useState(initialTasks)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'done' | 'all'>('pending')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assigneeFilterItems = useMemo(
    () => ({ all: 'Todos os admins', ...Object.fromEntries(admins.map((a) => [a.id, a.name])) }),
    [admins]
  )
  const accountFilterItems = useMemo(
    () => ({
      all: 'Todos os clientes',
      none: 'Sem cliente',
      ...Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    }),
    [accounts]
  )
  const assigneeFormItems = useMemo(
    () => ({ none: 'Sem responsável', ...Object.fromEntries(admins.map((a) => [a.id, a.name])) }),
    [admins]
  )
  const accountFormItems = useMemo(
    () => ({ none: 'Sem cliente', ...Object.fromEntries(accounts.map((a) => [a.id, a.name])) }),
    [accounts]
  )

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || undefined,
          due_date: dueDate || undefined,
          assigned_to: assignedTo || undefined,
          account_id: accountId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível criar a tarefa.')
        return
      }
      const assignee = admins.find((a) => a.id === data.assigned_to)
      const account = accounts.find((a) => a.id === data.account_id)
      setTasks((prev) => [
        {
          id: data.id,
          title: data.title,
          description: data.description,
          dueDate: data.due_date,
          status: data.status,
          accountId: data.account_id,
          accountName: account?.name ?? null,
          assignedTo: data.assigned_to,
          assigneeName: assignee?.name ?? null,
        },
        ...prev,
      ])
      setTitle('')
      setDescription('')
      setDueDate('')
      setAssignedTo('')
      setAccountId('')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (task: GlobalTaskRow) => {
    const nextStatus: AccountTaskStatus = task.status === 'pending' ? 'done' : 'pending'
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    await fetch(`/api/admin/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
  }

  const removeTask = async (task: GlobalTaskRow) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    await fetch(`/api/admin/tasks/${task.id}`, { method: 'DELETE' })
  }

  const filtered = useMemo(() => {
    return tasks
      .filter((t) => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false
        if (assigneeFilter !== 'all' && t.assignedTo !== assigneeFilter) return false
        if (accountFilter === 'none' && t.accountId) return false
        if (accountFilter !== 'all' && accountFilter !== 'none' && t.accountId !== accountFilter) return false
        return true
      })
      .sort((a, b) => {
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      })
  }, [tasks, statusFilter, assigneeFilter, accountFilter])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-gray-900">Nova tarefa</h2>
        <form onSubmit={createTask} className="mt-4 space-y-2">
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
              items={accountFormItems}
              value={accountId || 'none'}
              onValueChange={(v) => setAccountId(!v || v === 'none' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-48 text-xs">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem cliente</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={assigneeFormItems}
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v as 'pending' | 'done' | 'all')}
        >
          <SelectTrigger className="h-9 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="done">Concluídas</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Select items={assigneeFilterItems} value={assigneeFilter} onValueChange={(v) => v && setAssigneeFilter(v)}>
          <SelectTrigger className="h-9 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os admins</SelectItem>
            {admins.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={accountFilterItems} value={accountFilter} onValueChange={(v) => v && setAccountFilter(v)}>
          <SelectTrigger className="h-9 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            <SelectItem value="none">Sem cliente</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma tarefa encontrada.</p>
        ) : (
          <ul className="divide-y divide-[var(--navy-06)]">
            {filtered.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <Switch checked={task.status === 'done'} onCheckedChange={() => toggleStatus(task)} />
                  </div>
                  <div>
                    <p className={cn('text-sm font-medium', task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900')}>
                      {task.title}
                    </p>
                    {task.description && <p className="mt-0.5 text-xs text-gray-400">{task.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      {task.accountId ? (
                        <Link href={`/admin/accounts/${task.accountId}`} className="hover:text-[var(--cyan-dark)]">
                          {task.accountName}
                        </Link>
                      ) : (
                        <span>Sem cliente</span>
                      )}
                      {task.dueDate && (
                        <span className={isOverdue(task.dueDate, task.status) ? 'font-medium text-red-500' : ''}>
                          · {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </span>
                      )}
                      {task.assigneeName && <span>· {task.assigneeName}</span>}
                    </p>
                  </div>
                </div>
                <button onClick={() => removeTask(task)} className="text-gray-300 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
