'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { endOfNextMonth } from '@/lib/scheduling/booking-window'

const saoPauloToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const formatDate = (date: string) => date.split('-').reverse().join('/')

// "Agenda aberta até": a Clara só oferece horário até essa data. Dias
// bloqueados dentro dela continuam fora. Vazio = sem limite.
export function BookingWindowSetting({
  workspaceId,
  initialValue,
  canManage,
}: {
  workspaceId: string
  initialValue: string | null
  canManage: boolean
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const [savedValue, setSavedValue] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = saoPauloToday()

  const save = async (next: string) => {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_open_until: next || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(friendlyErrorMessage(data.error ?? 'Erro ao salvar.'))
        return
      }
      setValue(next)
      setSavedValue(next)
    } finally {
      setSaving(false)
    }
  }

  const status = savedValue
    ? savedValue < today
      ? `A data já passou: a Clara não está oferecendo nenhum horário nesta unidade.`
      : `A Clara oferece horários até ${formatDate(savedValue)}. Dias bloqueados dentro desse período continuam fora.`
    : 'Sem limite: a Clara oferece os próximos horários livres do expediente.'

  return (
    <div className="mb-6 rounded-lg border border-[var(--navy-06)] bg-gray-50/60 p-4">
      <Label htmlFor="booking_open_until">Agenda aberta até</Label>
      <p className="mb-2 text-xs text-gray-400">
        Use quando a agenda dos próximos meses ainda não foi montada. Depois dessa data a Clara diz ao paciente que a agenda ainda não foi liberada.
      </p>
      <fieldset disabled={!canManage || saving} className="flex flex-wrap items-center gap-2">
        <Input
          id="booking_open_until"
          type="date"
          min={today}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-44"
        />
        <Button type="button" size="sm" onClick={() => save(value)} disabled={value === savedValue}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setValue(endOfNextMonth(today))}>
          Até o fim do mês que vem
        </Button>
        {savedValue && (
          <Button type="button" size="sm" variant="ghost" onClick={() => save('')}>
            Remover limite
          </Button>
        )}
      </fieldset>
      <p className="mt-2 text-xs text-gray-500">{status}</p>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
