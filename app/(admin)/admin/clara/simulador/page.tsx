import { createClient } from '@/lib/supabase/server'
import { getWorkspaceBotSettings } from '@/lib/bot/unit-settings'
import { PRESET_COLUMNS, type BotPreset } from '@/lib/bot/presets'
import { SimulatorClient, type SimAccount } from '@/components/admin/clara/SimulatorClient'

type WorkspaceRow = {
  id: string
  account_id: string
  name: string
  scheduling_mode?: string | null
  intake_fields?: string[] | null
  bot_instructions?: string | null
  bot_preset_id?: string | null
}

export default async function AdminClaraSimulatorPage() {
  const supabase = await createClient()

  const loadWorkspaces = async () => {
    const full = await supabase
      .from('workspaces')
      .select('id, account_id, name, scheduling_mode, intake_fields, bot_instructions, bot_preset_id')
      .eq('is_active', true)
      .order('display_order')
    if (!full.error) return full
    // Migration dos modelos pendente: sem bot_preset_id.
    return supabase
      .from('workspaces')
      .select('id, account_id, name, scheduling_mode, intake_fields, bot_instructions')
      .eq('is_active', true)
      .order('display_order')
  }

  const [{ data: accounts }, { data: workspaces }, { data: insurers }, { data: presets }] = await Promise.all([
    supabase.from('accounts').select('id, name').order('name'),
    loadWorkspaces(),
    supabase.from('health_insurers').select('id, name, account_id').eq('is_active', true).order('name'),
    supabase.from('bot_presets').select(PRESET_COLUMNS).order('name'),
  ])

  const byAccount = new Map<string, SimAccount>()
  for (const a of accounts ?? []) byAccount.set(a.id, { id: a.id, name: a.name, units: [], insurers: [] })
  for (const w of (workspaces ?? []) as WorkspaceRow[]) {
    const s = getWorkspaceBotSettings(w)
    byAccount.get(w.account_id)?.units.push({
      id: w.id,
      name: w.name,
      settings: { scheduling_mode: s.schedulingMode, intake_fields: s.intakeFields, bot_instructions: s.botInstructions },
      presetId: w.bot_preset_id ?? null,
    })
  }
  for (const i of insurers ?? []) byAccount.get(i.account_id)?.insurers.push({ id: i.id, name: i.name })

  return (
    <SimulatorClient
      accounts={[...byAccount.values()].filter((a) => a.units.length > 0)}
      presets={(presets ?? []) as BotPreset[]}
    />
  )
}
