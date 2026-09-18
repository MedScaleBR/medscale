'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { formatVisit } from '@/lib/bot/inbox'

interface ConversationContextBarProps {
  patientId: string | null
  tags: string[]
  lastVisit: string | null
  nextAppointment: string | null
  notes: string | null
  onNotesSaved: (notes: string) => void
}

export function ConversationContextBar({
  patientId,
  tags,
  lastVisit,
  nextAppointment,
  notes,
  onNotesSaved,
}: ConversationContextBarProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(notes ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // O pai monta este componente com key={patientId}, então trocar de conversa
  // já zera draft/open — não precisa de efeito de reset, e assim salvar a nota
  // (que atualiza a prop notes) não fecha o painel embaixo de quem digita.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const save = async (value: string) => {
    if (!patientId) return
    setState('saving')
    try {
      const res = await fetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      })
      if (!res.ok) throw new Error('save failed')
      setState('saved')
      onNotesSaved(value)
    } catch {
      setState('error')
    }
  }

  const handleChange = (value: string) => {
    setDraft(value)
    setState('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save(value), 800)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 px-4 py-2 md:px-5">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--navy-06)] px-2 py-0.5 text-[11px] font-medium text-[var(--navy)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <span className="text-xs text-gray-500">
          Última: <span className="text-[var(--navy)]">{formatVisit(lastVisit, false)}</span>
        </span>
        <span className="text-xs text-gray-500">
          Próxima: <span className="text-[var(--navy)]">{formatVisit(nextAppointment, true)}</span>
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={!patientId}
          className="ml-auto text-xs font-medium text-[var(--cyan-dark)] disabled:cursor-not-allowed disabled:text-gray-400"
          title={patientId ? undefined : 'Disponível depois que o paciente for cadastrado.'}
        >
          {open ? 'Ocultar notas' : 'Notas internas'}
        </button>
      </div>

      {open && (
        <div className="border-b border-[var(--navy-06)] px-4 py-3 md:px-5">
          <Textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            rows={2}
            placeholder="Nota interna — visível só para a equipe."
            className="resize-none text-sm"
          />
          <p
            className={cn(
              'mt-1 text-[11px]',
              state === 'error' ? 'text-[var(--danger-text)]' : 'text-gray-400'
            )}
          >
            {state === 'saving' && 'Salvando...'}
            {state === 'saved' && 'Nota salva.'}
            {state === 'error' && 'Não foi possível salvar. A nota continua aqui — tente de novo.'}
            {state === 'idle' && 'Salva sozinha enquanto você escreve.'}
          </p>
        </div>
      )}
    </>
  )
}
