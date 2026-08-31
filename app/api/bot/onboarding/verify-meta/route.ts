import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'
import { trackBotWizardCompleted } from '@/lib/analytics/posthog-server'

// Confirma que o Phone Number ID + token colados pelo médico são válidos,
// consultando a própria Meta Graph API, antes de salvar. A conexão WhatsApp
// da Maria é única por account (bot_config).
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  if (session.role === 'member') {
    return NextResponse.json({ error: 'Apenas admins da account podem configurar o WhatsApp.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { phone_number_id, meta_token, meta_app_secret } = await req.json()
  if (!phone_number_id || !meta_token || !meta_app_secret) {
    return NextResponse.json(
      { error: 'phone_number_id, meta_token e meta_app_secret são obrigatórios' },
      { status: 400 }
    )
  }

  const metaRes = await fetch(
    `https://graph.facebook.com/v19.0/${phone_number_id}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${meta_token}` } }
  )

  if (!metaRes.ok) {
    const body = await metaRes.json().catch(() => null)
    const metaMessage: string = body?.error?.message ?? metaRes.statusText
    const metaCode = body?.error?.code

    const looksLikeWrongIdType =
      metaCode === 100 && /nonexisting field/i.test(metaMessage) && /display_phone_number/i.test(metaMessage)

    const error = looksLikeWrongIdType
      ? 'Esse ID não é de um número de telefone. Confira se você colou o "Phone Number ID" — não o "WhatsApp Business Account ID" (WABA) — da tela API Setup da Meta; eles ficam lado a lado e são fáceis de trocar.'
      : `Não foi possível validar com a Meta: ${metaMessage}`

    return NextResponse.json({ error }, { status: 400 })
  }

  const metaData = await metaRes.json()

  const { data: botConfig, error: botConfigError } = await supabase
    .from('bot_config')
    .upsert(
      {
        account_id: session.accountId,
        phone_number_id,
        meta_token: encryptToken(meta_token),
        meta_app_secret: encryptToken(meta_app_secret),
        whatsapp_number: metaData.display_phone_number ?? null,
        number_source: 'own',
        onboarding_step: 'verified',
        is_active: true,
      },
      { onConflict: 'account_id' }
    )
    .select()
    .single()

  if (botConfigError) return NextResponse.json({ error: botConfigError.message }, { status: 500 })

  invalidateBotConfigCache(session.accountId)

  await trackBotWizardCompleted(session.userId, {
    workspace_id: session.workspaceId,
    account_id: session.accountId,
    number_source: 'own',
  })

  return NextResponse.json({
    ok: true,
    displayPhoneNumber: metaData.display_phone_number,
    verifiedName: metaData.verified_name,
    botConfig,
  })
}
