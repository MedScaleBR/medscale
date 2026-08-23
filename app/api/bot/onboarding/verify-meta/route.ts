import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'

// Confirma que o Phone Number ID + token colados pelo médico são válidos,
// consultando a própria Meta Graph API, antes de salvar.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // A policy de RLS de `workspaces` só permite update para admin do account —
  // sem este gate, um membro comum faria a chamada, o RLS bloquearia as 0
  // linhas silenciosamente (sem lançar erro), e a rota ainda responderia
  // ok: true como se tivesse salvo.
  if (session.role === 'member') {
    return NextResponse.json({ error: 'Apenas admins da account podem configurar o WhatsApp.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { phone_number_id, meta_token } = await req.json()
  if (!phone_number_id || !meta_token) {
    return NextResponse.json({ error: 'phone_number_id e meta_token são obrigatórios' }, { status: 400 })
  }

  const metaRes = await fetch(
    `https://graph.facebook.com/v19.0/${phone_number_id}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${meta_token}` } }
  )

  if (!metaRes.ok) {
    const body = await metaRes.json().catch(() => null)
    const metaMessage: string = body?.error?.message ?? metaRes.statusText
    const metaCode = body?.error?.code

    // Erro clássico de colar o WhatsApp Business Account ID (WABA) no lugar
    // do Phone Number ID — a tela "API Setup" da Meta mostra os dois lado a
    // lado e são fáceis de confundir; só o objeto "número de telefone" tem
    // o campo display_phone_number, o WABA não.
    const looksLikeWrongIdType =
      metaCode === 100 && /nonexisting field/i.test(metaMessage) && /display_phone_number/i.test(metaMessage)

    const error = looksLikeWrongIdType
      ? 'Esse ID não é de um número de telefone. Confira se você colou o "Phone Number ID" — não o "WhatsApp Business Account ID" (WABA) — da tela API Setup da Meta; eles ficam lado a lado e são fáceis de trocar.'
      : `Não foi possível validar com a Meta: ${metaMessage}`

    return NextResponse.json({ error }, { status: 400 })
  }

  const metaData = await metaRes.json()

  const { error: workspaceError } = await supabase
    .from('workspaces')
    .update({
      phone_number_id,
      meta_token: encryptToken(meta_token),
      whatsapp_number: metaData.display_phone_number ?? null,
    })
    .eq('id', session.workspaceId)

  if (workspaceError) return NextResponse.json({ error: workspaceError.message }, { status: 500 })

  const { data: botConfig, error: botConfigError } = await supabase
    .from('bot_config')
    .upsert(
      {
        workspace_id: session.workspaceId,
        account_id: session.accountId,
        number_source: 'own',
        onboarding_step: 'verified',
        is_active: true,
      },
      { onConflict: 'workspace_id' }
    )
    .select()
    .single()

  if (botConfigError) return NextResponse.json({ error: botConfigError.message }, { status: 500 })

  invalidateBotConfigCache(session.workspaceId)

  return NextResponse.json({
    ok: true,
    displayPhoneNumber: metaData.display_phone_number,
    verifiedName: metaData.verified_name,
    botConfig,
  })
}
