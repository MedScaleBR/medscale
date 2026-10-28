import { getWorkspaceBotSettings, parseBotSettingsBody, type BotSettingsUpdate, type WorkspaceBotSettings } from '@/lib/bot/unit-settings'

// Modelos de configuração da Clara (bot_presets). Aplicar um modelo COPIA os
// valores para a unidade; workspaces.bot_preset_id é só a referência de onde
// veio, para o formulário mostrar "Baseado em: <modelo> (alterado)".

export interface BotPreset {
  id: string
  name: string
  description: string | null
  scheduling_mode: BotSettingsUpdate['scheduling_mode']
  intake_fields: BotSettingsUpdate['intake_fields']
  bot_instructions: string | null
}

export const PRESET_COLUMNS = 'id, name, description, scheduling_mode, intake_fields, bot_instructions'
export const PRESET_NAME_MAX = 80
export const PRESET_DESCRIPTION_MAX = 300
export const PRESET_NAME_TAKEN_ERROR = 'Já existe um modelo com esse nome.'

export type PresetBody = BotSettingsUpdate & { name: string; description: string | null }

/** Valida criação/edição de modelo: mesmas regras da configuração da unidade. */
export function parsePresetBody(body: unknown): { ok: true; value: PresetBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Corpo inválido.' }
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return { ok: false, error: 'Dê um nome ao modelo.' }
  if (name.length > PRESET_NAME_MAX) return { ok: false, error: `O nome pode ter no máximo ${PRESET_NAME_MAX} caracteres.` }
  const description = typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null
  if (description && description.length > PRESET_DESCRIPTION_MAX) {
    return { ok: false, error: `A descrição pode ter no máximo ${PRESET_DESCRIPTION_MAX} caracteres.` }
  }
  const settings = parseBotSettingsBody(b)
  if (!settings.ok) return settings
  return { ok: true, value: { ...settings.value, name, description } }
}

/** Valores que a unidade recebe ao aplicar o modelo (com os mínimos do modo). */
export function presetSettings(preset: Pick<BotPreset, 'scheduling_mode' | 'intake_fields' | 'bot_instructions'>): WorkspaceBotSettings {
  return getWorkspaceBotSettings(preset)
}

/** A configuração ainda é igual à do modelo? (para o "(alterado)"). */
export function matchesPreset(settings: WorkspaceBotSettings, preset: Pick<BotPreset, 'scheduling_mode' | 'intake_fields' | 'bot_instructions'>): boolean {
  const p = presetSettings(preset)
  return (
    settings.schedulingMode === p.schedulingMode &&
    (settings.botInstructions ?? null) === (p.botInstructions ?? null) &&
    settings.intakeFields.length === p.intakeFields.length &&
    settings.intakeFields.every((f, i) => f === p.intakeFields[i])
  )
}

/** Texto do "Baseado em", ou null se a unidade não veio de modelo (ou ele foi excluído). */
export function presetBadge(
  presetId: string | null | undefined,
  settings: WorkspaceBotSettings,
  presets: readonly BotPreset[]
): string | null {
  if (!presetId) return null
  const preset = presets.find((p) => p.id === presetId)
  if (!preset) return null
  return `Baseado em: ${preset.name}${matchesPreset(settings, preset) ? '' : ' (alterado)'}`
}
