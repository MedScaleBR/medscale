'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { presetBadge, presetSettings, type BotPreset } from '@/lib/bot/presets'

export type BotSettingsValue = BotSettingsUpdate

interface WorkspaceBotSettingsFormProps {
  /** Usado nos ids dos campos — várias unidades na mesma tela. */
  idPrefix: string
  value: BotSettingsValue
  /**
   * Recebe a configuração nova e o modelo de onde ela veio (null = nenhum;
   * undefined = não mudou); devolve uma mensagem de erro, ou null se salvou.
   */
  onSubmit: (next: BotSettingsValue, presetId: string | null | undefined) => Promise<string | null>
  /** Ex.: "Última alteração por ..." abaixo do botão. */
  footer?: ReactNode
  /** Texto do botão de salvar. */
  submitLabel?: string
  /** Modelos disponíveis para "Aplicar modelo" e para o "Baseado em". */
  presets?: BotPreset[]
  /** Modelo de onde a configuração salva veio (workspaces.bot_preset_id). */
  presetId?: string | null
  /** Cria um modelo a partir do formulário; devolve erro, ou null se criou. */
  onSaveAsPreset?: (name: string, value: BotSettingsValue) => Promise<string | null>
  /** Avisa a cada mudança (o simulador usa como rascunho, sem salvar). */
  onChange?: (next: BotSettingsValue) => void
}

// Formulário da Clara por unidade. Não sabe de rota nem de página: recebe a
// configuração atual e devolve a nova por callback (reaproveitado no simulador).
export function WorkspaceBotSettingsForm({
  idPrefix,
  value,
  onSubmit,
  footer,
  submitLabel = 'Salvar',
  presets = [],
  presetId = null,
  onSaveAsPreset,
  onChange,
}: WorkspaceBotSettingsFormProps) {
  const [mode, setMode] = useState<SchedulingMode>(value.scheduling_mode)
  const [fields, setFields] = useState<IntakeField[]>(value.intake_fields)
  const [instructions, setInstructions] = useState(value.bot_instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Modelo aplicado neste formulário (ainda não salvo); undefined = nenhum.
  const [appliedPresetId, setAppliedPresetId] = useState<string | undefined>(undefined)
  const [presetName, setPresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState<'idle' | 'open' | 'saving'>('idle')
  const [presetMessage, setPresetMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const current = (): BotSettingsValue => ({
    scheduling_mode: mode,
    intake_fields: normalizeIntakeFields(mode, fields),
    bot_instructions: instructions.trim() || null,
  })

  // onChange fica numa ref para não reexecutar o efeito quando o pai recria a função.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    onChangeRef.current?.({
      scheduling_mode: mode,
      intake_fields: normalizeIntakeFields(mode, fields),
      bot_instructions: instructions.trim() || null,
    })
  }, [mode, fields, instructions])

  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    const next = presetSettings(preset)
    setMode(next.schedulingMode)
    setFields(next.intakeFields)
    setInstructions(next.botInstructions ?? '')
    setAppliedPresetId(preset.id)
    setSaved(false)
  }

  const effectivePresetId = appliedPresetId ?? presetId
  const badge = presetBadge(
    effectivePresetId,
    { schedulingMode: mode, intakeFields: normalizeIntakeFields(mode, fields), botInstructions: instructions.trim() || null },
    presets
  )

  const handleSaveAsPreset = async () => {
    if (!onSaveAsPreset || !presetName.trim()) return
    setSavingPreset('saving')
    setPresetMessage(null)
    const problem = await onSaveAsPreset(presetName.trim(), current())
    if (problem) {
      setSavingPreset('open')
      setPresetMessage({ ok: false, text: problem })
    } else {
      setSavingPreset('idle')
      setPresetName('')
      setPresetMessage({ ok: true, text: 'Modelo criado.' })
    }
  }

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
    const problem = await onSubmit(current(), appliedPresetId)
    setSaving(false)
    if (problem) setError(problem)
    else setSaved(true)
  }

  return (
    <div className="space-y-5">
      {(presets.length > 0 || badge) && (
        <div className="flex flex-wrap items-center gap-3">
          {presets.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span>Aplicar modelo</span>
              <select
                aria-label="Aplicar modelo"
                value=""
                onChange={(e) => applyPreset(e.target.value)}
                className="h-8 rounded-md border border-[var(--navy-06)] bg-white px-2 text-sm"
              >
                <option value="">Escolher…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {badge && <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{badge}</span>}
          {appliedPresetId && <span className="text-xs text-gray-400">Clique em salvar para gravar.</span>}
        </div>
      )}

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
            {saving ? 'Salvando...' : submitLabel}
          </Button>
          {saved && <span className="text-xs text-gray-500">Salvo.</span>}
          {onSaveAsPreset && savingPreset === 'idle' && (
            <Button
              type="button"
              variant="outline"
              disabled={!!instructionsProblem}
              onClick={() => {
                setSavingPreset('open')
                setPresetMessage(null)
              }}
            >
              Salvar como modelo
            </Button>
          )}
        </div>
        {onSaveAsPreset && savingPreset !== 'idle' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Nome do modelo"
              value={presetName}
              maxLength={80}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Nome do modelo"
              className="h-8 w-64"
            />
            <Button type="button" size="sm" disabled={!presetName.trim() || savingPreset === 'saving'} onClick={handleSaveAsPreset}>
              {savingPreset === 'saving' ? 'Criando...' : 'Criar modelo'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSavingPreset('idle')}>
              Cancelar
            </Button>
          </div>
        )}
        {presetMessage && (
          <p className={cn('text-xs', presetMessage.ok ? 'text-gray-500' : 'text-red-500')}>{presetMessage.text}</p>
        )}
        {footer}
      </div>
    </div>
  )
}
