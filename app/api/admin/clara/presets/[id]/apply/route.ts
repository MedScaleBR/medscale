import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { PRESET_COLUMNS, presetSettings, type BotPreset } from '@/lib/bot/presets'

// "Aplicar modelo a todas as unidades" de uma account. Copia os valores do
// modelo para cada unidade ativa (a tela já mostrou a lista e pediu confirmação).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth

  const body = (await req.json().catch(() => null)) as { account_id?: unknown } | null
  const accountId = typeof body?.account_id === 'string' ? body.account_id : null
  if (!accountId) return NextResponse.json({ error: 'Informe a account.' }, { status: 400 })

  const { data: preset } = await supabase.from('bot_presets').select(PRESET_COLUMNS).eq('id', id).maybeSingle()
  if (!preset) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })

  const settings = presetSettings(preset as BotPreset)
  const { data, error } = await supabase
    .from('workspaces')
    .update({
      scheduling_mode: settings.schedulingMode,
      intake_fields: settings.intakeFields,
      bot_instructions: settings.botInstructions,
      bot_preset_id: preset.id,
      bot_settings_updated_by: user.id,
      bot_settings_updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('is_active', true)
    .select('id, name, scheduling_mode, intake_fields, bot_instructions, bot_preset_id, bot_settings_updated_by, bot_settings_updated_at')
  if (error) {
    console.error(`[admin] aplicar modelo falhou account=${accountId} preset=${id}`)
    return NextResponse.json({ error: 'Não foi possível aplicar o modelo.' }, { status: 500 })
  }

  const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle()
  return NextResponse.json({ workspaces: data ?? [], updated_by_name: profile?.full_name ?? profile?.email ?? null })
}
