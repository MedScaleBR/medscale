'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, X } from 'lucide-react'
import type { Database } from '@/types/database'

export type HandoffScheduleHour = Pick<Database['public']['Tables']['handoff_hours']['Row'], 'id' | 'day_of_week' | 'start_time' | 'end_time'>

const DAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// O Select (Base UI) só resolve o label da opção selecionada automaticamente
// se receber esse mapa — sem ele, mostra o value bruto (ex: "1" em vez de "Segunda").
const DAY_ITEMS = Object.fromEntries(DAY_LABEL.map((label, i) => [String(i), label]))

export function HandoffHoursSettings({
  initialHours,
  workspaceId,
  scope,
  emptyMessage = 'Nenhum horário cadastrado — atendimento humano disponível 24/7.',
  onHoursChange,
  onSavingChange,
}: {
  initialHours: HandoffScheduleHour[]
  // Quando editando uma unidade que não é a ativa na sessão, passa o id — as
  // rotas de handoff-hours aceitam ?workspace_id= como override.
  workspaceId?: string
  scope?: 'global'
  emptyMessage?: string
  onHoursChange?: (hours: HandoffScheduleHour[]) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const [hours, setHours] = useState(initialHours)
  const [form, setForm] = useState({ day_of_week: '1', start_time: '08:00', end_time: '17:00' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qs = scope === 'global' ? '?scope=global' : workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''

  const updateHours = (next: HandoffScheduleHour[]) => {
    setHours(next)
    onHoursChange?.(next)
  }

  const updateSaving = (value: boolean) => {
    setSaving(value)
    onSavingChange?.(value)
  }

  const addRule = async () => {
    updateSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/bot/handoff-hours${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week: Number(form.day_of_week),
          start_time: form.start_time,
          end_time: form.end_time,
        }),
      })
      const created = await res.json()
      if (!res.ok) throw new Error(created.error ?? 'Não foi possível adicionar o horário.')
      updateHours([...hours, created].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)))
    } catch {
      setError('Não foi possível adicionar o horário. Confira os horários e tente novamente.')
    } finally {
      updateSaving(false)
    }
  }

  const removeRule = async (id: string) => {
    updateSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/bot/handoff-hours/${id}${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Não foi possível remover o horário.')
      updateHours(hours.filter((r) => r.id !== id))
    } catch {
      setError('Não foi possível remover o horário. Tente novamente.')
    } finally {
      updateSaving(false)
    }
  }

  return (
    <div>
      <p className="text-xs text-gray-400">
        Fora destes horários, o bot continua respondendo e agendando sozinho normalmente — só avisa
        o paciente que a equipe humana vai responder assim que o expediente começar, em vez de
        tentar transferir a conversa para ninguém.
      </p>

      <div className="mt-3 space-y-2">
        {DAY_LABEL.map((label, day) => {
          const dayRules = hours.filter((r) => r.day_of_week === day)
          if (dayRules.length === 0) return null
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-medium text-gray-500">{label}</span>
              {dayRules.map((r) => (
                <Badge key={r.id} className="gap-1.5 border-none bg-[var(--navy-06)] text-[var(--navy)]">
                  {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                  <button type="button" disabled={saving} aria-label={`Remover horário de ${label}, ${r.start_time.slice(0, 5)} a ${r.end_time.slice(0, 5)}`} onClick={() => removeRule(r.id)} className="ml-0.5 hover:text-red-600 disabled:opacity-50">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )
        })}
        {hours.length === 0 && (
          <p className="text-sm text-gray-400">{emptyMessage}</p>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Dia</Label>
          <Select
            items={DAY_ITEMS}
            value={form.day_of_week}
            onValueChange={(v) => v && setForm((f) => ({ ...f, day_of_week: v }))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_LABEL.map((label, i) => (
                <SelectItem key={i} value={String(i)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Início</Label>
          <Input
            type="time"
            className="w-28"
            value={form.start_time}
            onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">Fim</Label>
          <Input
            type="time"
            className="w-28"
            value={form.end_time}
            onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
          />
        </div>
        <Button onClick={addRule} disabled={saving} size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Adicionar
        </Button>
      </div>
    </div>
  )
}
