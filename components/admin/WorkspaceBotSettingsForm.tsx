'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  BOT_INSTRUCTIONS_MAX,
  botInstructionsProblem,
  EXTERNAL_DEFAULT_FIELDS,
  EXTERNAL_REQUIRED_FIELDS,
  INTAKE_FIELD_LABELS,
  INTAKE_FIELDS,
  normalizeIntakeFields,
  SCHEDULING_MODE_LABELS,
  SCHEDULING_MODES,
  type BotSettingsUpdate,
  type IntakeField,
  type SchedulingMode,
} from '@/lib/bot/unit-settings'

export type BotSettingsValue = BotSettingsUpdate

interface WorkspaceBotSettingsFormProps {
  /** Usado nos ids dos campos — várias unidades na mesma tela. */
  idPrefix: string
  value: BotSettingsValue
  /** Recebe a configuração nova; devolve uma mensagem de erro, ou null se salvou. */
  onSubmit: (next: BotSettingsValue) => Promise<string | null>
  /** Ex.: "Última alteração por ..." abaixo do botão. */
  footer?: ReactNode
}

// Formulário da Clara por unidade. Não sabe de rota nem de página: recebe a
// configuração atual e devolve a nova por callback (reaproveitado no simulador).
export function WorkspaceBotSettingsForm({ idPrefix, value, onSubmit, footer }: WorkspaceBotSettingsFormProps) {
  const [mode, setMode] = useState<SchedulingMode>(value.scheduling_mode)
  const [fields, setFields] = useState<IntakeField[]>(value.intake_fields)
  const [instructions, setInstructions] = useState(value.bot_instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const changeMode = (next: SchedulingMode) => {
    if (next === mode) return
    setMode(next)
    setSaved(false)
    // Ao trocar para agenda externa, pré-marca o que a equipe costuma precisar.
    setFields((prev) => normalizeIntakeFields(next, next === 'external' ? [...prev, ...EXTERNAL_DEFAULT_FIELDS] : prev))
  }

  const toggleField = (field: IntakeField, checked: boolean) => {
    setSaved(false)
    setFields((prev) => normalizeIntakeFields(mode, checked ? [...prev, field] : prev.filter((f) => f !== field)))
  }

  const trimmed = instructions.trim()
  const instructionsProblem = trimmed ? botInstructionsProblem(trimmed) : null

  const handleSubmit = async () => {
    if (instructionsProblem) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const problem = await onSubmit({
      scheduling_mode: mode,
      intake_fields: normalizeIntakeFields(mode, fields),
      bot_instructions: trimmed || null,
    })
    setSaving(false)
    if (problem) setError(problem)
    else setSaved(true)
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-gray-900">Modo de agenda</legend>
        {SCHEDULING_MODES.map((m) => (
          <label
            key={m}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
              mode === m ? 'border-[var(--cyan)] bg-[var(--cyan-10)]' : 'border-[var(--navy-06)] hover:bg-gray-50'
            )}
          >
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={m}
              checked={mode === m}
              onChange={() => changeMode(m)}
              className="mt-0.5 accent-[var(--cyan-dark)]"
            />
            <span className="text-gray-800">{SCHEDULING_MODE_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-900">Dados a coletar</legend>
        <p className="mb-2 text-xs text-gray-400">
          {mode === 'external'
            ? 'A Clara pede estes dados antes de passar a solicitação para a equipe. O telefone é sempre o da conversa.'
            : 'A Clara pede estes dados antes de confirmar o agendamento. Vazio = como hoje.'}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {INTAKE_FIELDS.map((f) => {
            const required = mode === 'external' && EXTERNAL_REQUIRED_FIELDS.includes(f)
            const unavailable = mode === 'internal' && f === 'preference'
            return (
              <label
                key={f}
                className={cn('flex items-start gap-2 text-sm', unavailable ? 'text-gray-300' : 'text-gray-700')}
                title={unavailable ? 'Só na agenda externa: na agenda da MedScale o paciente escolhe um horário real.' : undefined}
              >
                <input
                  type="checkbox"
                  checked={fields.includes(f)}
                  disabled={required || unavailable}
                  onChange={(e) => toggleField(f, e.target.checked)}
                  className="mt-0.5 accent-[var(--cyan-dark)]"
                />
                <span>
                  {INTAKE_FIELD_LABELS[f]}
                  {required && <span className="ml-1 text-xs text-gray-400">(obrigatório)</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <Label htmlFor={`${idPrefix}-instructions`}>Instruções para a Clara</Label>
        <Textarea
          id={`${idPrefix}-instructions`}
          value={instructions}
          maxLength={BOT_INSTRUCTIONS_MAX}
          rows={4}
          onChange={(e) => {
            setInstructions(e.target.value)
            setSaved(false)
          }}
          placeholder="Ex.: Avise que o estacionamento é no subsolo. Para retorno, pergunte a data da última consulta."
          className="mt-1"
        />
        <div className="mt-1 flex justify-between gap-4 text-xs text-gray-400">
          <span>Essas instruções não mudam as regras de segurança da Clara.</span>
          <span className="shrink-0 tabular-nums">
            {instructions.length}/{BOT_INSTRUCTIONS_MAX}
          </span>
        </div>
        {instructionsProblem && <p className="mt-1 text-xs text-red-500">{instructionsProblem}</p>}
      </div>

      <div className="space-y-2">
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSubmit}
            disabled={saving || !!instructionsProblem}
            className="bg-[var(--cyan)] font-medium text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          {saved && <span className="text-xs text-gray-500">Salvo.</span>}
        </div>
        {footer}
      </div>
    </div>
  )
}
