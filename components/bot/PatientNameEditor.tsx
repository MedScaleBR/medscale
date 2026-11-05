'use client'

import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { hasRealName } from '@/lib/bot/inbox'

const MAX_NAME_LENGTH = 200

interface PatientNameEditorProps {
  patientId: string | null
  /** Nome gravado no paciente ('Paciente' enquanto a Clara não souber o real). */
  fullName: string | null
  /** Nome do perfil do WhatsApp, se a Meta mandou. */
  whatsappName: string | null
  /** O que o cabeçalho mostra (nome real, do WhatsApp ou telefone). */
  title: string
  onSaved: (fullName: string) => void
}

// Nome do paciente no cabeçalho da conversa, com edição no lugar. Salvar grava
// o nome real (patients.full_name): a Clara deixa de perguntar o nome.
export function PatientNameEditor({ patientId, fullName, whatsappName, title, onSaved }: PatientNameEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const realName = hasRealName(fullName) ? fullName!.trim() : null
  const suggestion = whatsappName && whatsappName !== realName ? whatsappName : null

  const start = () => {
    setDraft(realName ?? '')
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const name = draft.replace(/\s+/g, ' ').trim()
    if (!name) {
      setError('Informe o nome.')
      return
    }
    if (!patientId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name }),
      })
      if (!res.ok) throw new Error('save failed')
      onSaved(name)
      setEditing(false)
    } catch {
      setError('Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <p className="truncate text-sm font-semibold text-[var(--navy)]">{title}</p>
        {patientId && (
          <button
            onClick={start}
            title="Editar nome do paciente"
            aria-label="Editar nome do paciente"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-[var(--navy-06)] hover:text-[var(--navy)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input
          autoFocus
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
          }}
          placeholder="Nome completo do paciente"
          aria-label="Nome do paciente"
          className="h-8 w-56 text-sm"
          disabled={saving}
        />
        <button
          type="submit"
          disabled={saving}
          title="Salvar"
          aria-label="Salvar nome"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--cyan-dark)] hover:bg-[var(--cyan-10)] disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          title="Cancelar"
          aria-label="Cancelar edição"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-[var(--navy-06)] disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </form>
      {suggestion && draft.trim() !== suggestion && (
        <button
          type="button"
          onClick={() => setDraft(suggestion)}
          disabled={saving}
          className="mt-1 truncate text-left text-xs text-[var(--cyan-dark)] hover:underline"
        >
          Usar nome do WhatsApp: {suggestion}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
