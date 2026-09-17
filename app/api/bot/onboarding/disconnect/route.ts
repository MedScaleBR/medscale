import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'
import { decryptToken } from '@/lib/crypto'
import { unsubscribeAppFromWaba } from '@/lib/meta/embedded-signup'

// Desfaz a conexão com a Meta: limpa as credenciais do WhatsApp da account e
// desativa a Clara. Não mexe na personalidade/FAQ/handoff — só na conexão.
export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  if (session.role === 'member') {
    return NextResponse.json({ error: 'Apenas admins da account podem desconectar o WhatsApp.' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: current } = await supabase
    .from('bot_config')
    .select('waba_id, meta_token')
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (current?.waba_id && current.meta_token) {
    try {
      await unsubscribeAppFromWaba(current.waba_id, decryptToken(current.meta_token))
    } catch (err) {
      // Token já revogado do lado da Meta é caso comum — não faz sentido
      // prender o usuário a uma conexão que ele já quer fora.
      Sentry.captureException(err, { tags: { area: 'meta', flow: 'disconnect' } })
    }
  }

  // number_source é NOT NULL no schema — mantemos o valor atual e só voltamos o
  // passo pra 'pending', o que já faz o wizard reaparecer no BotConfigForm.
  const { data: botConfig, error: botConfigError } = await supabase
    .from('bot_config')
    .update({
      phone_number_id: null,
      meta_token: null,
      waba_id: null,
      whatsapp_pin: null,
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
