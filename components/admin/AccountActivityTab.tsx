'use client'

import { useState } from 'react'
import { Mail, Phone, StickyNote, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccountNoteType } from '@/types/database'

export interface NoteRow {
  id: string
  type: AccountNoteType
  body: string
  authorName: string
  createdAt: string
}

const TYPE_LABEL: Record<AccountNoteType, string> = {
  note: 'Nota',
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
}

const TYPE_ICON: Record<AccountNoteType, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: Users,
}

const TYPE_SELECT_ITEMS = TYPE_LABEL

export function AccountActivityTab({
  accountId,
  initialNotes,
  currentAdminName,
}: {
  accountId: string
  initialNotes: NoteRow[]
  currentAdminName: string
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [type, setType] = useState<AccountNoteType>('note')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, body }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar a nota.')
        return
      }
      setNotes((prev) => [
        { id: data.id, type: data.type, body: data.body, authorName: currentAdminName, createdAt: data.created_at },
        ...prev,
      ])
      setBody('')
      setType('note')
    } finally {
      setSaving(false)
    }
  }

  const removeNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    await fetch(`/api/admin/accounts/${accountId}/notes/${noteId}`, { method: 'DELETE' })
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-medium text-gray-900">Atividade</h2>

      <form onSubmit={submit} className="mt-4 space-y-2">
        <div className="flex items-center gap-2">
          <Select items={TYPE_SELECT_ITEMS} value={type} onValueChange={(v) => v && setType(v as AccountNoteType)}>
            <SelectTrigger className="h-9 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Nota</SelectItem>
              <SelectItem value="call">Ligação</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="meeting">Reunião</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Registrar uma interação com esta conta..."
          className="min-h-20"
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={saving || !body.trim()}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Registrar'}
          </Button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="mt-6 text-sm text-gray-400">Nenhuma atividade registrada ainda.</p>
      ) : (
        <ul className="mt-6 space-y-4 border-t border-[var(--navy-06)] pt-4">
          {notes.map((n) => {
            const Icon = TYPE_ICON[n.type]
            return (
              <li key={n.id} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cyan-10)]">
                  <Icon className="h-3.5 w-3.5 text-[var(--cyan-dark)]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-700">
                      {TYPE_LABEL[n.type]} · {n.authorName}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('pt-BR')}</span>
                      <button onClick={() => removeNote(n.id)} className="text-gray-300 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{n.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
