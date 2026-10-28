import { createClient } from '@/lib/supabase/server'
import { PRESET_COLUMNS, type BotPreset } from '@/lib/bot/presets'
import { PresetsManager } from '@/components/admin/clara/PresetsManager'

export default async function AdminClaraPresetsPage() {
  const supabase = await createClient()
  const [{ data: presets, error }, { data: refs }] = await Promise.all([
    supabase.from('bot_presets').select(PRESET_COLUMNS).order('name'),
    supabase.from('workspaces').select('bot_preset_id').not('bot_preset_id', 'is', null),
  ])

  if (error) {
    return (
      <p className="text-sm text-gray-400">
        Os modelos ficam disponíveis depois que a migration supabase/migration_clara_simulador_modelos.sql for aplicada.
      </p>
    )
  }

  const usage = new Map<string, number>()
  for (const r of refs ?? []) if (r.bot_preset_id) usage.set(r.bot_preset_id, (usage.get(r.bot_preset_id) ?? 0) + 1)

  return (
    <PresetsManager
      initialPresets={((presets ?? []) as BotPreset[]).map((p) => ({ ...p, units_count: usage.get(p.id) ?? 0 }))}
    />
  )
}
