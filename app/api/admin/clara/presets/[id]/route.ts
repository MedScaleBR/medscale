import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { parsePresetBody, PRESET_COLUMNS, PRESET_NAME_TAKEN_ERROR } from '@/lib/bot/presets'

// Editar o modelo não muda as unidades que já o aplicaram (cópia, não vínculo).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = parsePresetBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await supabase.from('bot_presets').update(parsed.value).eq('id', id).select(PRESET_COLUMNS).maybeSingle()
  if (error?.code === '23505') return NextResponse.json({ error: PRESET_NAME_TAKEN_ERROR }, { status: 409 })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar o modelo.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
  return NextResponse.json({ preset: data })
}

// Excluir não mexe nas unidades: a FK zera workspaces.bot_preset_id e a
// configuração copiada continua igual.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const { data, error } = await supabase.from('bot_presets').delete().eq('id', id).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível excluir o modelo.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
