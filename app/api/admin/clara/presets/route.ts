import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { parsePresetBody, PRESET_COLUMNS, PRESET_NAME_TAKEN_ERROR } from '@/lib/bot/presets'

// Modelos de configuração da Clara — só a equipe MedScale (RLS de bot_presets
// também exige is_medscale_admin()).

export async function GET() {
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const [{ data: presets, error }, { data: refs }] = await Promise.all([
    supabase.from('bot_presets').select(PRESET_COLUMNS).order('name'),
    supabase.from('workspaces').select('bot_preset_id').not('bot_preset_id', 'is', null),
  ])
  if (error) return NextResponse.json({ error: 'Não foi possível carregar os modelos.' }, { status: 500 })

  const usage = new Map<string, number>()
  for (const r of refs ?? []) if (r.bot_preset_id) usage.set(r.bot_preset_id, (usage.get(r.bot_preset_id) ?? 0) + 1)

  return NextResponse.json({ presets: (presets ?? []).map((p) => ({ ...p, units_count: usage.get(p.id) ?? 0 })) })
}

export async function POST(req: NextRequest) {
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth

  const parsed = parsePresetBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await supabase
    .from('bot_presets')
    .insert({ ...parsed.value, created_by: user.id })
    .select(PRESET_COLUMNS)
    .single()
  if (error?.code === '23505') return NextResponse.json({ error: PRESET_NAME_TAKEN_ERROR }, { status: 409 })
  if (error || !data) return NextResponse.json({ error: 'Não foi possível criar o modelo.' }, { status: 500 })
  return NextResponse.json({ preset: { ...data, units_count: 0 } }, { status: 201 })
}
