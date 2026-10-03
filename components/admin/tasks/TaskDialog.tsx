'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AccountTaskStatus } from '@/types/database'
import { COLUMN_LABELS, personLabel, type BoardTask, type PersonOption } from './board-logic'
import type { AccountOption, TaskFormValues } from './use-task-board'

export type TaskDialogMode = { kind: 'create'; status: AccountTaskStatus } | { kind: 'edit'; task: BoardTask }

const FIELD_CLASS = 'h-9 rounded-[10px]'
const LABEL_CLASS = 'text-xs text-gray-500'

function initialValues(mode: TaskDialogMode): TaskFormValues {
  if (mode.kind === 'create') {
    return { title: '', description: '', dueDate: '', accountId: '', assignedTo: '', status: mode.status }
  }
  const t = mode.task
  return {
    title: t.title,
    description: t.description ?? '',
    dueDate: t.dueDate ?? '',
    accountId: t.accountId ?? '',
    assignedTo: t.assignedTo ?? '',
    status: t.status,
  }
}

/** Monte com `key` diferente a cada abertura: o formulário nasce do `mode`. */
export function TaskDialog({
  open,
  onOpenChange,
  mode,
  admins,
  accounts,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: TaskDialogMode
  admins: PersonOption[]
  accounts: AccountOption[]
  onCreate: (values: TaskFormValues) => Promise<string | null>
  onUpdate: (task: BoardTask, values: TaskFormValues) => Promise<string | null>
  onDelete: (task: BoardTask) => void
}) {
  const [values, setValues] = useState(() => initialValues(mode))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const id = useId()
  const editing = mode.kind === 'edit'

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.title.trim() || saving) return
    setSaving(true)
    setError(null)
    const message = mode.kind === 'edit' ? await onUpdate(mode.task, values) : await onCreate(values)
    setSaving(false)
    if (message) {
      setError(message)
      return
    }
    onOpenChange(false)
  }

  const remove = () => {
    if (mode.kind !== 'edit') return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete(mode.task)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="text-base font-medium text-gray-900">
              {editing ? 'Editar tarefa' : 'Nova tarefa'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              {editing
                ? `Na coluna ${COLUMN_LABELS[values.status]}`
                : `Entra no fim da coluna ${COLUMN_LABELS[values.status]}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            <div className="space-y-1">
              <label htmlFor={`${id}-title`} className={LABEL_CLASS}>
                Título
              </label>
              <Input
                id={`${id}-title`}
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="O que precisa ser feito"
                className={FIELD_CLASS}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-description`} className={LABEL_CLASS}>
                Descrição
              </label>
              <Textarea
                id={`${id}-description`}
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Opcional"
                className="min-h-16 rounded-[10px]"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-due`} className={LABEL_CLASS}>
                  Prazo
                </label>
                <input
                  id={`${id}-due`}
                  type="date"
                  value={values.dueDate}
                  onChange={(e) => set('dueDate', e.target.value)}
                  className="h-9 w-full rounded-[10px] border border-gray-200 px-2.5 text-sm outline-none focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
                />
              </div>
              <div className="space-y-1">
                <span id={`${id}-assignee`} className={LABEL_CLASS}>
                  Responsável
                </span>
                <Select
                  value={values.assignedTo || 'none'}
                  onValueChange={(v) => set('assignedTo', !v || v === 'none' ? '' : String(v))}
                >
                  <SelectTrigger aria-labelledby={`${id}-assignee`} className="h-9 w-full rounded-[10px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem responsável</SelectItem>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {personLabel(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <span id={`${id}-account`} className={LABEL_CLASS}>
                Cliente
              </span>
              <Select
                value={values.accountId || 'none'}
                onValueChange={(v) => set('accountId', !v || v === 'none' ? '' : String(v))}
                disabled={editing}
              >
                <SelectTrigger aria-labelledby={`${id}-account`} className="h-9 w-full rounded-[10px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cliente (interna)</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && <p className="text-xs text-gray-400">O cliente não muda depois que a tarefa é criada.</p>}
            </div>
            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 items-center rounded-b-xl border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-5 py-3 sm:justify-between">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={remove}
                className="text-red-600 hover:bg-red-50 hover:text-red-600"
              >
                {confirmDelete ? 'Confirmar exclusão' : 'Excluir tarefa'}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving || !values.title.trim()}
                className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
              >
                {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar tarefa'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
