import type { BotPreset } from '@/lib/bot/presets'
import type { BotSettingsUpdate } from '@/lib/bot/unit-settings'

// Chamadas do navegador às rotas da Clara em /admin (formulário, seção da
// account, simulador e modelos). Cada uma devolve { error } ou o dado.

const NETWORK_ERROR = 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.'

async function call<T>(url: string, init: RequestInit): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { data: null, error: body.error ?? 'Algo deu errado. Tente de novo.' }
    return { data: body as T, error: null }
  } catch {
    return { data: null, error: NETWORK_ERROR }
  }
}

export interface SavedBotSettings {
  bot_settings_updated_at: string | null
  bot_preset_id?: string | null
  updated_by_name: string | null
}

export function saveWorkspaceBotSettings(workspaceId: string, value: BotSettingsUpdate, presetId: string | null | undefined) {
  return call<SavedBotSettings>(`/api/admin/workspaces/${workspaceId}/bot-settings`, {
    method: 'PATCH',
    body: JSON.stringify(presetId === undefined ? value : { ...value, bot_preset_id: presetId }),
  })
}

export type PresetWithUsage = BotPreset & { units_count: number }

export function createPreset(input: BotSettingsUpdate & { name: string; description?: string | null }) {
  return call<{ preset: PresetWithUsage }>('/api/admin/clara/presets', { method: 'POST', body: JSON.stringify(input) })
}

export function updatePreset(id: string, input: BotSettingsUpdate & { name: string; description?: string | null }) {
  return call<{ preset: BotPreset }>(`/api/admin/clara/presets/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deletePreset(id: string) {
  return call<{ ok: true }>(`/api/admin/clara/presets/${id}`, { method: 'DELETE' })
}

export interface AppliedWorkspace {
  id: string
  scheduling_mode: BotSettingsUpdate['scheduling_mode']
  intake_fields: BotSettingsUpdate['intake_fields']
  bot_instructions: string | null
  bot_preset_id: string | null
  bot_settings_updated_at: string | null
}

export function applyPresetToAccount(presetId: string, accountId: string) {
  return call<{ workspaces: AppliedWorkspace[]; updated_by_name: string | null }>(`/api/admin/clara/presets/${presetId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
  })
}
