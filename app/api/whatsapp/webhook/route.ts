import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { processIncomingMessage, handleUnsupportedMessage } from '@/lib/llm/agent'
import { processFinancialMessage, sendFinanceReply } from '@/lib/finance/agent'
import { buildUnsupportedTypeMessage } from '@/lib/finance/respond'
import { decryptToken } from '@/lib/crypto'

// Valida a assinatura HMAC enviada pela Meta para garantir que o payload
// realmente veio da Meta e não foi forjado. `secret` é o App Secret do App
// Meta que assinou a mensagem — o App único da MedScale (META_APP_SECRET)
// para o fluxo compartilhado, ou o App Secret próprio da workspace no fluxo
// "número próprio" (cada App só assina com o seu próprio secret).
function validateMetaSignature(payload: string, signature: string, secret: string | null | undefined): boolean {
  if (!signature || !secret) return false
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const expectedSig = `sha256=${expected}`
  if (expectedSig.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256') ?? ''

  let body
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const entry = body?.entry?.[0]
  const changes = entry?.changes?.[0]
  const value = changes?.value
  const phoneNumberId: string | undefined = value?.metadata?.phone_number_id

  // Encontrar a workspace pelo phone_number_id — precisamos disso já aqui
  // (antes de aceitar/rejeitar a assinatura) porque, no fluxo "número
  // próprio", a assinatura só é validável com o App Secret daquela workspace.
  const { data: workspace } = phoneNumberId
    ? await supabase
        .from('workspaces')
        .select('id, name, account_id, meta_app_secret')
        .eq('phone_number_id', phoneNumberId)
        .single()
    : { data: null }

  const workspaceSecret = workspace?.meta_app_secret ? decryptToken(workspace.meta_app_secret) : null
  const validSignature =
    validateMetaSignature(rawBody, signature, process.env.META_APP_SECRET) ||
    validateMetaSignature(rawBody, signature, workspaceSecret)

  if (!validSignature) {
    console.warn('[whatsapp webhook] signature validation failed', {
      workspaceId: workspace?.id ?? null,
      hasWorkspaceSecret: Boolean(workspaceSecret),
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!value?.messages) {
    return NextResponse.json({ status: 'ignored' })
  }

  const message = value.messages[0]
  const from = message.from // telefone do paciente (ou do owner, no fluxo financeiro)
  const text = message.type === 'text' ? message.text.body : null

  // Mensagem chegou no número financeiro dedicado da MedScale — fora do
  // modelo de workspace (o owner registra PF/PJ consolidado por account),
  // então é tratada antes da resolução de workspace abaixo. Mesmo App Meta
  // e mesmo META_APP_SECRET do fluxo compartilhado, só o phone_number_id
  // e o token de envio (FINANCE_META_TOKEN) são diferentes.
  if (phoneNumberId && phoneNumberId === process.env.FINANCE_PHONE_NUMBER_ID) {
    if (message.type !== 'text') {
      after(() =>
        sendFinanceReply(from, buildUnsupportedTypeMessage()).catch((err) =>
          console.error('sendFinanceReply (unsupported type) failed', err)
        )
      )
      return NextResponse.json({ status: 'ok' })
    }

    after(() =>
      processFinancialMessage(from, text ?? '').catch((err) => console.error('processFinancialMessage failed', err))
    )
    return NextResponse.json({ status: 'ok' })
  }

  // Log do webhook para debugging — associado à workspace quando identificável.
  // Guardamos o id da linha para poder gravar o erro nela especificamente
  // depois (ver abaixo) — atualizar "a linha mais recente da workspace" era
  // uma corrida: outra mensagem podia chegar antes do catch rodar e o erro
  // acabava gravado na linha errada.
  const { data: webhookLog } = await supabase
    .from('webhook_logs')
    .insert({ workspace_id: workspace?.id ?? null, payload: body })
    .select('id')
    .single()

  if (!workspace) {
    return NextResponse.json({ status: 'workspace_not_found' })
  }

  // A Meta exige resposta em <20s — o processamento roda após a resposta HTTP
  // ser enviada, via `after()` (equivalente a waitUntil no Vercel).
  if (text) {
    after(() =>
      processIncomingMessage({
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        workspaceName: workspace.name,
        patientPhone: from,
        message: text,
        whatsappMessageId: message.id,
      }).catch(async (err) => {
        console.error('processIncomingMessage failed', err)
        if (webhookLog) {
          const { error: updateError } = await supabase
            .from('webhook_logs')
            .update({ error: String(err) })
            .eq('id', webhookLog.id)
          if (updateError) console.error('failed to persist webhook_logs.error', updateError)
        }
      })
    )
  } else {
    // Áudio, imagem, documento, figurinha etc. — a Maria não entende o
    // conteúdo, mas avisa o paciente em vez de ficar em silêncio.
    after(() =>
      handleUnsupportedMessage({
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        patientPhone: from,
        messageType: message.type,
        whatsappMessageId: message.id,
      }).catch((err) => console.error('handleUnsupportedMessage failed', err))
    )
  }

  return NextResponse.json({ status: 'ok' })
}

// Verificação do webhook pela Meta (handshake inicial de configuração).
// Aceita tanto o META_VERIFY_TOKEN global (App único da MedScale) quanto um
// webhook_verify_token específico de uma workspace que traz seu próprio App
// Meta (fluxo "número próprio" — cada App configura seu próprio verify token).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token) {
    console.warn('[whatsapp webhook] verify failed: missing hub.mode/hub.verify_token', { mode })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  const supabase = createAdminClient()
  const { data: match } = await supabase
    .from('bot_config')
    .select('id')
    .eq('webhook_verify_token', token)
    .maybeSingle()

  if (match) {
    return new NextResponse(challenge, { status: 200 })
  }

  // Não logamos o token em si (evita vazar segredo nos logs) — só o
  // suficiente para diferenciar "env var não configurada" de "valor errado".
  console.warn('[whatsapp webhook] verify failed: token did not match META_VERIFY_TOKEN nor any bot_config', {
    metaVerifyTokenConfigured: Boolean(process.env.META_VERIFY_TOKEN),
    tokenLength: token.length,
  })

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
