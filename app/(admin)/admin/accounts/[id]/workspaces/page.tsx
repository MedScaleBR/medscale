import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { WorkspacesClient } from '@/components/locais/WorkspacesClient'
import { WorkspaceBotSettingsSection, type WorkspaceBotSettingsRow } from '@/components/admin/WorkspaceBotSettingsSection'
import { getWorkspaceBotSettings } from '@/lib/bot/unit-settings'
import { PRESET_COLUMNS, type BotPreset } from '@/lib/bot/presets'

type BotSettingsColumns = {
  id: string
  scheduling_mode: string | null
  intake_fields: string[] | null
  bot_instructions: string | null
  bot_settings_updated_by: string | null
  bot_settings_updated_at: string | null
  bot_preset_id?: string | null
}

const BOT_COLUMNS = 'id, scheduling_mode, intake_fields, bot_instructions, bot_settings_updated_by, bot_settings_updated_at'

export default async function AdminAccountWorkspacesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Com bot_preset_id (migration dos modelos); sem ela, cai nas colunas antigas.
  const loadBotSettings = async () => {
    const withPreset = await supabase.from('workspaces').select(`${BOT_COLUMNS}, bot_preset_id`).eq('account_id', id)
    if (!withPreset.error) return withPreset
    return supabase.from('workspaces').select(BOT_COLUMNS).eq('account_id', id)
  }

  const [{ data: account }, { data: workspaces }, botSettingsResult, { data: presetRows }] = await Promise.all([
    supabase.from('accounts').select('id, name').eq('id', id).single(),
    supabase
      .from('workspaces')
      .select('id, name, slug, address, city, state, zip_code, is_active, is_default, display_order')
      .eq('account_id', id)
      .order('display_order'),
    // À parte: se a migration da Clara por unidade ainda não rodou, a página
    // continua abrindo (só sem a seção).
    loadBotSettings(),
    supabase.from('bot_presets').select(PRESET_COLUMNS).order('name'),
  ])
  const presets = (presetRows ?? []) as BotPreset[]

  if (!account) notFound()

  const botRows = (botSettingsResult.error ? [] : (botSettingsResult.data ?? [])) as BotSettingsColumns[]
  const botById = new Map(botRows.map((r) => [r.id, r]))
  const updaterIds = [...new Set(botRows.map((r) => r.bot_settings_updated_by).filter((v): v is string => !!v))]
  const { data: updaters } = updaterIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', updaterIds)
    : { data: [] }
  const updaterName = new Map((updaters ?? []).map((p) => [p.id, p.full_name ?? p.email ?? null]))

  const settingsRows: WorkspaceBotSettingsRow[] = botSettingsResult.error
    ? []
    : (workspaces ?? []).map((w) => {
        const row = botById.get(w.id)
        const s = getWorkspaceBotSettings(row ?? {})
        return {
          id: w.id,
          name: w.name,
          settings: {
            scheduling_mode: s.schedulingMode,
            intake_fields: s.intakeFields,
            bot_instructions: s.botInstructions,
          },
          presetId: row?.bot_preset_id ?? null,
          updatedByName: row?.bot_settings_updated_by ? (updaterName.get(row.bot_settings_updated_by) ?? null) : null,
          updatedAt: row?.bot_settings_updated_at ?? null,
        }
      })

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/admin/accounts/${id}`} className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          {account.name}
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Unidades</h1>
        <p className="text-sm text-gray-400">Workspaces da account {account.name}.</p>
      </div>

      <WorkspacesClient
        initialWorkspaces={workspaces ?? []}
        canManage
        apiBase={`/api/admin/accounts/${id}/workspaces`}
      />

      {botSettingsResult.error ? (
        <p className="text-sm text-gray-400">
          A configuração da Clara por unidade fica disponível depois que a migration for aplicada.
        </p>
      ) : (
        settingsRows.length > 0 && <WorkspaceBotSettingsSection accountId={id} rows={settingsRows} presets={presets} />
      )}
    </div>
  )
}
