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
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackAvailabilityRulesSaved } from '@/lib/analytics/posthog'
import type { Database } from '@/types/database'

type AvailabilityRule = Database['public']['Tables']['availability_rules']['Row']
type AvailabilityException = Database['public']['Tables']['availability_exceptions']['Row']

const DAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// O Select (Base UI) só resolve o label da opção selecionada automaticamente
// se receber esse mapa — sem ele, mostra o value bruto (ex: "1" em vez de "Segunda").
const DAY_ITEMS = Object.fromEntries(DAY_LABEL.map((label, i) => [String(i), label]))

interface AvailabilitySettingsProps {
  initialRules: AvailabilityRule[]
  initialExceptions: AvailabilityException[]
}

export function AvailabilitySettings({ initialRules, initialExceptions }: AvailabilitySettingsProps) {
  const [rules, setRules] = useState(initialRules)
  const [exceptions, setExceptions] = useState(initialExceptions)
  const [ruleForm, setRuleForm] = useState({ day_of_week: '1', start_time: '08:00', end_time: '12:00', slot_duration: '30' })
  const [savingRule, setSavingRule] = useState(false)
  const [excForm, setExcForm] = useState({ date: '', reason: '' })
  const [savingExc, setSavingExc] = useState(false)
  const analyticsBase = useAnalyticsBase()

  const addRule = async () => {
    setSavingRule(true)
    try {
      const res = await fetch('/api/availability/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week: Number(ruleForm.day_of_week),
          start_time: ruleForm.start_time,
          end_time: ruleForm.end_time,
          slot_duration: Number(ruleForm.slot_duration),
        }),
      })
      if (res.ok) {
        const created = await res.json()
        const next = [...rules, created]
        setRules(next.sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)))
        trackAvailabilityRulesSaved({
          ...analyticsBase,
          days_configured: new Set(next.map((r) => r.day_of_week)).size,
        })
      }
    } finally {
      setSavingRule(false)
    }
  }

  const removeRule = async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/availability/rules/${id}`, { method: 'DELETE' })
  }

  const addException = async () => {
    if (!excForm.date) return
    setSavingExc(true)
    try {
      const res = await fetch('/api/availability/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: excForm.date, type: 'blocked', reason: excForm.reason || null }),
      })
      if (res.ok) {
        const created = await res.json()
        setExceptions((prev) => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
        setExcForm({ date: '', reason: '' })
      }
    } finally {
      setSavingExc(false)
    }
  }

  const removeException = async (id: string) => {
    setExceptions((prev) => prev.filter((e) => e.id !== id))
    await fetch(`/api/availability/exceptions/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900">Horários de atendimento recorrentes</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Usados pelo bot para oferecer horários e para bloquear a agenda fora do expediente.
        </p>

        <div className="mt-3 space-y-2">
          {DAY_LABEL.map((label, day) => {
            const dayRules = rules.filter((r) => r.day_of_week === day)
            if (dayRules.length === 0) return null
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-medium text-gray-500">{label}</span>
                {dayRules.map((r) => (
                  <Badge key={r.id} className="gap-1.5 border-none bg-[var(--navy-06)] text-[var(--navy)]">
                    {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} ({r.slot_duration}min)
                    <button onClick={() => removeRule(r.id)} className="ml-0.5 hover:text-red-600">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )
          })}
          {rules.length === 0 && <p className="text-sm text-gray-400">Nenhum horário configurado ainda.</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Dia</Label>
            <Select
              items={DAY_ITEMS}
              value={ruleForm.day_of_week}
              onValueChange={(v) => v && setRuleForm((f) => ({ ...f, day_of_week: v }))}
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
              value={ruleForm.start_time}
              onChange={(e) => setRuleForm((f) => ({ ...f, start_time: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input
              type="time"
              className="w-28"
              value={ruleForm.end_time}
              onChange={(e) => setRuleForm((f) => ({ ...f, end_time: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Duração do slot (min)</Label>
            <Input
              type="number"
              className="w-28"
              value={ruleForm.slot_duration}
              onChange={(e) => setRuleForm((f) => ({ ...f, slot_duration: e.target.value }))}
            />
          </div>
          <Button
            onClick={addRule}
            disabled={savingRule}
            size="sm"
            className="gap-1.5 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>

      <div className="border-t border-[var(--navy-06)] pt-5">
        <h3 className="text-sm font-medium text-gray-900">Dias bloqueados</h3>
        <p className="mt-0.5 text-xs text-gray-400">Feriados, férias ou qualquer dia sem atendimento.</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {exceptions.map((e) => (
            <Badge key={e.id} className="gap-1.5 border-none bg-red-50 text-red-600">
              {new Date(`${e.date}T12:00:00`).toLocaleDateString('pt-BR')}
              {e.reason ? ` — ${e.reason}` : ''}
              <button onClick={() => removeException(e.id)} className="ml-0.5 hover:text-red-800">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {exceptions.length === 0 && <p className="text-sm text-gray-400">Nenhum dia bloqueado.</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Data</Label>
            <Input
              type="date"
              value={excForm.date}
              onChange={(e) => setExcForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input
              placeholder="Feriado, férias..."
              value={excForm.reason}
              onChange={(e) => setExcForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <Button onClick={addException} disabled={savingExc} size="sm" variant="outline" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Bloquear dia
          </Button>
        </div>
      </div>
    </div>
  )
}
