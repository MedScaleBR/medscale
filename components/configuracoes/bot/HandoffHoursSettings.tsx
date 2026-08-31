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

type HandoffHour = Database['public']['Tables']['handoff_hours']['Row']

const DAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// O Select (Base UI) só resolve o label da opção selecionada automaticamente
// se receber esse mapa — sem ele, mostra o value bruto (ex: "1" em vez de "Segunda").
const DAY_ITEMS = Object.fromEntries(DAY_LABEL.map((label, i) => [String(i), label]))

export function HandoffHoursSettings({
  initialHours,
  workspaceId,
}: {
  initialHours: HandoffHour[]
  // Quando editando uma unidade que não é a ativa na sessão, passa o id — as
  // rotas de handoff-hours aceitam ?workspace_id= como override.
  workspaceId?: string
}) {
  const [hours, setHours] = useState(initialHours)
  const [form, setForm] = useState({ day_of_week: '1', start_time: '08:00', end_time: '17:00' })
  const [saving, setSaving] = useState(false)

  const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''

  const addRule = async () => {
    setSaving(true)
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
      if (res.ok) {
        const created = await res.json()
        setHours((prev) =>
          [...prev, created].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (id: string) => {
    setHours((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/bot/handoff-hours/${id}${qs}`, { method: 'DELETE' })
  }

  return (
    <div>
      <p className="text-xs text-gray-400">
        Fora destes horários, o bot continua respondendo e agendando sozinho normalmente — só avisa
        o paciente que a equipe humana vai responder assim que o expediente começar, em vez de
        tentar transferir a conversa para ninguém. Sem nenhum horário cadastrado, o handoff fica
        disponível 24/7.
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
                  <button onClick={() => removeRule(r.id)} className="ml-0.5 hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )
        })}
        {hours.length === 0 && (
          <p className="text-sm text-gray-400">Nenhum horário cadastrado — handoff disponível 24/7.</p>
        )}
      </div>

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
