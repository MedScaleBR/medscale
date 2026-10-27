import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { parseBotSettingsBody } from '@/lib/bot/unit-settings'

// Configuração da Clara por unidade — só a equipe MedScale. Usa o client da
// sessão (como as outras rotas de /admin): a RLS "medscale admin full" libera o
// UPDATE e o trigger protect_workspace_bot_settings aceita is_medscale_admin().
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth

  const body = await req.json().catch(() => null)
  const parsed = parseBotSettingsBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await supabase
    .from('workspaces')
    .update({
      ...parsed.value,
      bot_settings_updated_by: user.id,
      bot_settings_updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, scheduling_mode, intake_fields, bot_instructions, bot_settings_updated_by, bot_settings_updated_at')
    .maybeSingle()

  if (error) {
    console.error(`[admin] bot-settings falhou workspace=${id}`)
    return NextResponse.json({ error: 'Não foi possível salvar a configuração.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle()

  return NextResponse.json({
    ...data,
    updated_by_name: profile?.full_name ?? profile?.email ?? null,
  })
}
