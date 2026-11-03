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
import { toast } from 'sonner'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackAvailabilityRulesSaved } from '@/lib/analytics/posthog'
import type { Database } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { groupBlockedDays } from '@/lib/availability/blocked-ranges'
import {
  addDaysToDate,
  formatDayMonth,
  INTERVAL_WEEKS_OPTIONS,
  intervalLabel,
  nextRuleDates,
  recurrenceProblem,
  weekdayOfDate,
} from '@/lib/scheduling/recurrence'

type AvailabilityRule = Database['public']['Tables']['availability_rules']['Row']
type AvailabilityException = Database['public']['Tables']['availability_exceptions']['Row']

const DAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// O Select (Base UI) só resolve o label da opção selecionada automaticamente
// se receber esse mapa — sem ele, mostra o value bruto (ex: "1" em vez de "Segunda").
const DAY_ITEMS = Object.fromEntries(DAY_LABEL.map((label, i) => [String(i), label]))

const INTERVAL_ITEMS: Record<string, string> = Object.fromEntries(
  INTERVAL_WEEKS_OPTIONS.map((n) => [String(n), n === 1 ? 'Toda semana' : `A cada ${n} semanas`])
)

/** Hoje (AAAA-MM-DD) no fuso do consultório. */
function saoPauloToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

/** Próxima data (hoje ou depois) que cai no dia da semana pedido. */
function nextWeekday(day: number): string {
  const today = saoPauloToday()
  return addDaysToDate(today, (day - weekdayOfDate(today) + 7) % 7)
}

const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')

interface AvailabilitySettingsProps {
  initialRules: AvailabilityRule[]
  initialExceptions: AvailabilityException[]
  workspaces: Array<{ id: string; name: string }>
  initialWorkspaceId: string
  canManage?: boolean
}

export function AvailabilitySettings({ initialRules, initialExceptions, workspaces, initialWorkspaceId, canManage = true }: AvailabilitySettingsProps) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId)
  const [rules, setRules] = useState(initialRules)
  const [exceptions, setExceptions] = useState(initialExceptions)
  const [ruleForm, setRuleForm] = useState({
    day_of_week: '1',
    start_time: '08:00',
    end_time: '12:00',
    slot_duration: '30',
    interval_weeks: '1',
    anchor_date: '',
  })
  const [savingRule, setSavingRule] = useState(false)
  const [excForm, setExcForm] = useState({ date: '', end_date: '', reason: '' })
  const [savingExc, setSavingExc] = useState(false)
  const analyticsBase = useAnalyticsBase()
  const workspaceItems = Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name]))
  const workspaceName = workspaceItems[workspaceId]
  const selectedRules = rules.filter((rule) => rule.workspace_id === workspaceId)
  const selectedExceptions = exceptions.filter((exception) => exception.workspace_id === workspaceId)
  // Só bloqueios de dia inteiro viram períodos; o resto aparece dia a dia.
  const isFullDayBlock = (e: AvailabilityException) => e.type === 'blocked' && !e.start_time
  const blockedRanges = groupBlockedDays(selectedExceptions.filter(isFullDayBlock))
  const otherExceptions = selectedExceptions.filter((e) => !isFullDayBlock(e))

  // Repetição da regra em edição: mesma validação e mesma conta de datas do servidor.
  const formDay = Number(ruleForm.day_of_week)
  const formInterval = Number(ruleForm.interval_weeks)
  const formAnchor = formInterval > 1 ? ruleForm.anchor_date || null : null
  const recurrenceError =
    formInterval > 1 && !ruleForm.anchor_date
      ? null // ainda não preencheu: o botão fica desabilitado, sem mensagem de erro
      : recurrenceProblem({ day_of_week: formDay, interval_weeks: formInterval, anchor_date: formAnchor })
  const previewDates =
    formInterval > 1 && formAnchor && !recurrenceError
      ? nextRuleDates(
          [{ day_of_week: formDay, interval_weeks: formInterval, anchor_date: formAnchor }],
          selectedExceptions.filter((e) => e.type === 'blocked' && !e.start_time),
          saoPauloToday(),
          3,
          120
        )
      : []
  const ruleIncomplete = formInterval > 1 && !ruleForm.anchor_date

  const changeInterval = (value: string) =>
    setRuleForm((f) => ({
      ...f,
      interval_weeks: value,
      // Sugere a próxima data do dia da semana escolhido como referência.
      anchor_date: Number(value) > 1 && !f.anchor_date ? nextWeekday(Number(f.day_of_week)) : f.anchor_date,
    }))

  const changeDay = (value: string) =>
    setRuleForm((f) => ({
      ...f,
      day_of_week: value,
      anchor_date: Number(f.interval_weeks) > 1 ? nextWeekday(Number(value)) : f.anchor_date,
    }))

  async function availabilityRequest(url: string, options: RequestInit) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || 'Não foi possível salvar o expediente. Tente novamente.')
    }
    return response
  }

  const addRule = async () => {
    setSavingRule(true)
    try {
      const res = await availabilityRequest('/api/availability/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week: Number(ruleForm.day_of_week),
          start_time: ruleForm.start_time,
          end_time: ruleForm.end_time,
          slot_duration: Number(ruleForm.slot_duration),
          ...(formInterval > 1 ? { interval_weeks: formInterval, anchor_date: formAnchor } : {}),
        }),
      })
      if (res.ok) {
        const created = await res.json()
        const next = [...rules, created]
        setRules(next.sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)))
        trackAvailabilityRulesSaved({
          ...analyticsBase,
          workspace_id: workspaceId,
          days_configured: new Set(next.filter((r) => r.workspace_id === workspaceId).map((r) => r.day_of_week)).size,
        })
      }
    } catch (error) {
      toast.error(friendlyErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar o horário.', "Não foi possível atualizar a disponibilidade. Tente novamente."))
    } finally {
      setSavingRule(false)
    }
  }

  const removeRule = async (id: string) => {
    try {
      await availabilityRequest(`/api/availability/rules/${id}`, { method: 'DELETE' })
      setRules((prev) => prev.filter((r) => r.id !== id))
    } catch (error) {
      toast.error(friendlyErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir o horário.', "Não foi possível atualizar a disponibilidade. Tente novamente."))
    }
  }

  const addException = async () => {
    if (!excForm.date) return
    const endDate = excForm.end_date && excForm.end_date !== excForm.date ? excForm.end_date : null
    if (endDate && endDate < excForm.date) {
      toast.error('A data final precisa ser igual ou posterior à inicial.')
      return
    }
    setSavingExc(true)
    try {
      const res = await availabilityRequest('/api/availability/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: excForm.date, end_date: endDate, type: 'blocked', reason: excForm.reason || null }),
      })
      if (res.ok) {
        const body = await res.json()
        const created: AvailabilityException[] = Array.isArray(body) ? body : [body]
        setExceptions((prev) => [...prev, ...created].sort((a, b) => a.date.localeCompare(b.date)))
        setExcForm({ date: '', end_date: '', reason: '' })
      }
    } catch (error) {
      toast.error(friendlyErrorMessage(error instanceof Error ? error.message : 'Não foi possível bloquear o dia.', "Não foi possível atualizar a disponibilidade. Tente novamente."))
    } finally {
      setSavingExc(false)
    }
  }

  const removeException = async (ids: string[]) => {
    try {
      if (ids.length === 1) {
        await availabilityRequest(`/api/availability/exceptions/${ids[0]}`, { method: 'DELETE' })
      } else {
        await availabilityRequest('/api/availability/exceptions', { method: 'DELETE', body: JSON.stringify({ ids }) })
      }
      setExceptions((prev) => prev.filter((e) => !ids.includes(e.id)))
    } catch (error) {
      toast.error(friendlyErrorMessage(error instanceof Error ? error.message : 'Não foi possível remover o bloqueio.', "Não foi possível atualizar a disponibilidade. Tente novamente."))
    }
  }

  return (
    <div className="space-y-6">
      {workspaces.length > 1 && <div>
        <Label htmlFor="availability-workspace">Local de atendimento</Label>
        <Select
          items={workspaceItems}
          value={workspaceId}
          onValueChange={(value) => value && setWorkspaceId(value)}
          disabled={savingRule || savingExc}
        >
          <SelectTrigger id="availability-workspace" className="mt-2 w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs text-gray-400">
          A Clara oferece os horários deste expediente quando o paciente escolhe este local.
        </p>
      </div>}
      <div>
        <h3 className="text-sm font-medium text-gray-900">Horários de atendimento recorrentes</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Usados pelo bot para oferecer horários e para bloquear a agenda fora do expediente.
        </p>

        <div className="mt-3 space-y-2">
          {DAY_LABEL.map((label, day) => {
            const dayRules = selectedRules.filter((r) => r.day_of_week === day)
            if (dayRules.length === 0) return null
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-medium text-gray-500">{label}</span>
                {dayRules.map((r) => (
                  <Badge key={r.id} className="gap-1.5 border-none bg-[var(--navy-06)] text-[var(--navy)]">
                    {workspaceName} · {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} ({r.slot_duration}min)
                    {(r.interval_weeks ?? 1) > 1 && ` · ${intervalLabel(r.interval_weeks)}`}
                    {canManage && <button aria-label={`Excluir horário de ${label} em ${workspaceName}`} onClick={() => removeRule(r.id)} className="ml-0.5 hover:text-red-600">
                      <X className="h-3 w-3" />
                    </button>}
                  </Badge>
                ))}
              </div>
            )
          })}
          {selectedRules.length === 0 && <p className="text-sm text-gray-400">Nenhum horário configurado para este local.</p>}
        </div>

        {canManage && <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Dia</Label>
            <Select
              items={DAY_ITEMS}
              value={ruleForm.day_of_week}
              onValueChange={(v) => v && changeDay(v)}
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
          <div>
            <Label className="text-xs">Repete</Label>
            <Select items={INTERVAL_ITEMS} value={ruleForm.interval_weeks} onValueChange={(v) => v && changeInterval(v)}>
              <SelectTrigger className="w-44" aria-label="Repete">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_WEEKS_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {INTERVAL_ITEMS[String(n)]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {formInterval > 1 && (
            <div>
              <Label className="text-xs" htmlFor="rule-anchor">
                Um dia em que atende ({DAY_LABEL[formDay].toLowerCase()})
              </Label>
              <Input
                id="rule-anchor"
                type="date"
                className="w-40"
                value={ruleForm.anchor_date}
                onChange={(e) => setRuleForm((f) => ({ ...f, anchor_date: e.target.value }))}
              />
            </div>
          )}
          <Button
            onClick={addRule}
            disabled={savingRule || ruleIncomplete || !!recurrenceError}
            size="sm"
            className="gap-1.5 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>}
        {canManage && formInterval > 1 && (
          <p className={`mt-2 text-xs ${recurrenceError ? 'text-red-500' : 'text-gray-500'}`}>
            {recurrenceError ??
              (ruleIncomplete
                ? 'Escolha um dia em que o atendimento acontece.'
                : previewDates.length > 0
                  ? `Próximas datas: ${previewDates.map(formatDayMonth).join(', ')}`
                  : 'Nenhuma data nos próximos meses (todas bloqueadas).')}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--navy-06)] pt-5">
        <h3 className="text-sm font-medium text-gray-900">Dias bloqueados</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Feriados, férias ou qualquer dia sem atendimento. Preencha &quot;Até&quot; para bloquear um período inteiro.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {blockedRanges.map((range) => {
            const label = range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} a ${formatDate(range.end)}`
            return (
              <Badge key={range.ids[0]} className="gap-1.5 border-none bg-red-50 text-red-600">
                {label}
                {range.reason ? ` — ${range.reason}` : ''}
                {canManage && <button aria-label={`Remover bloqueio de ${label} em ${workspaceName}`} onClick={() => removeException(range.ids)} className="ml-0.5 hover:text-red-800">
                  <X className="h-3 w-3" />
                </button>}
              </Badge>
            )
          })}
          {otherExceptions.map((e) => (
            <Badge key={e.id} className="gap-1.5 border-none bg-red-50 text-red-600">
              {formatDate(e.date)}
              {e.start_time && e.end_time ? ` ${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}` : ''}
              {e.reason ? ` — ${e.reason}` : ''}
              {canManage && <button aria-label={`Remover bloqueio de ${e.date} em ${workspaceName}`} onClick={() => removeException([e.id])} className="ml-0.5 hover:text-red-800">
                <X className="h-3 w-3" />
              </button>}
            </Badge>
          ))}
          {selectedExceptions.length === 0 && <p className="text-sm text-gray-400">Nenhum dia bloqueado para este local.</p>}
        </div>

        {canManage && <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={excForm.date}
              onChange={(e) => setExcForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Até (opcional)</Label>
            <Input
              type="date"
              min={excForm.date || undefined}
              value={excForm.end_date}
              onChange={(e) => setExcForm((f) => ({ ...f, end_date: e.target.value }))}
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
            {excForm.end_date && excForm.end_date !== excForm.date ? 'Bloquear período' : 'Bloquear dia'}
          </Button>
        </div>}
      </div>
    </div>
  )
}
