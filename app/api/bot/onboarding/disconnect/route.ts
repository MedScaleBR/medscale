import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'

// Desfaz a conexão com a Meta: limpa as credenciais do WhatsApp da account e
// desativa a Maria. Não mexe na personalidade/FAQ/handoff — só na conexão.
export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  if (session.role === 'member') {
    return NextResponse.json({ error: 'Apenas admins da account podem desconectar o WhatsApp.' }, { status: 403 })
  }

  const supabase = await createClient()

  // number_source é NOT NULL no schema — mantemos o valor atual e só voltamos o
  // passo pra 'pending', o que já faz o wizard reaparecer no BotConfigForm.
  const { data: botConfig, error: botConfigError } = await supabase
    .from('bot_config')
    .update({
      phone_number_id: null,
      meta_token: null,
      meta_app_secret: null,
      whatsapp_number: null,
      is_active: false,
      onboarding_step: 'pending',
    })
    .eq('account_id', session.accountId)
    .select()
    .maybeSingle()

  if (botConfigError) return NextResponse.json({ error: botConfigError.message }, { status: 500 })

  invalidateBotConfigCache(session.accountId)

  return NextResponse.json({ ok: true, botConfig })
}
