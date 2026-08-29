import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'

// Desfaz a conexão com a Meta: limpa as credenciais do WhatsApp na workspace e
// desativa o bot. Não mexe na personalidade/FAQ/handoff — só na conexão. Depois
// disso o médico precisa refazer o wizard de onboarding para reconectar.
export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // Mesmo gate do verify-meta: só admin do account tem RLS de update em
  // `workspaces`. Sem isso um member limparia bot_config e a workspace ficaria
  // meio-conectada, com as credenciais da Meta ainda no banco.
  if (session.role === 'member') {
    return NextResponse.json({ error: 'Apenas admins da account podem desconectar o WhatsApp.' }, { status: 403 })
  }

  const supabase = await createClient()

  const { error: workspaceError } = await supabase
    .from('workspaces')
    .update({
      phone_number_id: null,
      meta_token: null,
      meta_app_secret: null,
      whatsapp_number: null,
    })
    .eq('id', session.workspaceId)

  if (workspaceError) return NextResponse.json({ error: workspaceError.message }, { status: 500 })

  // number_source é NOT NULL no schema — mantemos o valor atual e só voltamos o
  // passo pra 'pending', o que já faz o wizard reaparecer no BotConfigForm.
  const { data: botConfig, error: botConfigError } = await supabase
    .from('bot_config')
    .update({ is_active: false, onboarding_step: 'pending' })
    .eq('workspace_id', session.workspaceId)
    .select()
    .maybeSingle()

  if (botConfigError) return NextResponse.json({ error: botConfigError.message }, { status: 500 })

  invalidateBotConfigCache(session.workspaceId)

  return NextResponse.json({ ok: true, botConfig })
}
