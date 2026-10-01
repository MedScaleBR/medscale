import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { trackBotWizardCompleted } from '@/lib/analytics/posthog-server'
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  registerPhoneNumber,
  fetchPhoneNumberInfo,
  fetchWabaPhoneNumberId,
  generatePin,
  isEmbeddedSignupConfigured,
} from '@/lib/meta/embedded-signup'
import { ensureWhatsAppTemplates } from '@/lib/meta/whatsapp-templates'

// Única porta de entrada para conectar o WhatsApp da Clara. Nada é gravado
// antes dos quatro passos da Meta darem certo: uma conexão pela metade é pior
// que nenhuma, porque o painel diz "conectado" e o bot não responde.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  if (!isEmbeddedSignupConfigured()) {
    return NextResponse.json({ error: 'Integração do WhatsApp ainda não liberada pela Meta.' }, { status: 503 })
  }

  // `coexistence`: o cliente conectou o número que já usa no app do WhatsApp
  // Business. A Meta devolve só o WABA e o número já vem registrado.
  const body = await req.json()
  const { code, waba_id } = body
  const coexistence = body.coexistence === true
  let phone_number_id: string | undefined = body.phone_number_id
  if (!code || !waba_id || (!phone_number_id && !coexistence)) {
    return NextResponse.json({ error: 'code, waba_id e phone_number_id são obrigatórios' }, { status: 400 })
  }

  // Coexistence não tem PIN: o /register seria recusado (o número já está
  // registrado) e a Meta manda pular esse passo.
  const pin = coexistence ? null : generatePin()

  let businessToken: string
  let info: { displayPhoneNumber: string | null; verifiedName: string | null }
  try {
    businessToken = await exchangeEmbeddedSignupCode(code)
    await subscribeAppToWaba(waba_id, businessToken)
    if (!phone_number_id) phone_number_id = await fetchWabaPhoneNumberId(waba_id, businessToken)
    if (pin) await registerPhoneNumber(phone_number_id, pin, businessToken)
    info = await fetchPhoneNumberInfo(phone_number_id, businessToken)
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'meta', flow: 'embedded_signup' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao conectar com a Meta.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('bot_config').upsert(
    {
      account_id: session.accountId,
      waba_id,
      phone_number_id,
      meta_token: encryptToken(businessToken),
      whatsapp_pin: pin ? encryptToken(pin) : null,
      whatsapp_number: info.displayPhoneNumber,
      number_source: 'own',
      is_active: true,
    },
    { onConflict: 'account_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateBotConfigCache(session.accountId)

  // Templates do lembrete e da lista de espera. Não bloqueia a conexão: o bot
  // responde sem eles, e dá para recriar com scripts/whatsapp-templates.ts.
  const templates = await ensureWhatsAppTemplates(waba_id, businessToken)
  if (templates.failed.length > 0) {
    Sentry.captureMessage('Falha ao criar templates do WhatsApp', {
      level: 'warning',
      tags: { area: 'meta', flow: 'embedded_signup' },
      extra: { account_id: session.accountId, waba_id, failed: templates.failed },
    })
  }
  await trackBotWizardCompleted(session.userId, {
    workspace_id: session.workspaceId,
    account_id: session.accountId,
    number_source: 'own',
  })

  return NextResponse.json({ ok: true, whatsappNumber: info.displayPhoneNumber })
}
