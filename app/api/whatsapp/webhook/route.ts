import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { processIncomingMessage, handleUnsupportedMessage } from '@/lib/llm/agent'
import { processFinancialMessage, sendFinanceReply } from '@/lib/finance/agent'
import { buildUnsupportedTypeMessage } from '@/lib/finance/respond'
import { decryptToken } from '@/lib/crypto'
import { checkRateLimit, RATE_LIMIT_NOTICE_MESSAGE } from '@/lib/rate-limit/webhook'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'

// Valida a assinatura HMAC enviada pela Meta para garantir que o payload
// realmente veio da Meta e não foi forjado. `secret` é o App Secret do App
// Meta que assinou a mensagem — o App único da MedScale (META_APP_SECRET)
// para o fluxo compartilhado, ou o App Secret próprio da account no fluxo
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

  // O número financeiro não é de nenhuma account (é o número único da MedScale
  // para o agente financeiro) — não adianta procurar bot_config pra ele.
  const isFinanceNumber = Boolean(phoneNumberId && phoneNumberId === process.env.FINANCE_PHONE_NUMBER_ID)

  // Encontrar a account pelo phone_number_id (a conexão WhatsApp da Maria vive
  // em bot_config, uma por account). Precisamos disso já aqui (antes de
  // aceitar/rejeitar a assinatura) porque, no fluxo "número próprio", a
  // assinatura só é validável com o App Secret daquela account.
  const { data: botConn } =
    phoneNumberId && !isFinanceNumber
      ? await supabase
          .from('bot_config')
          .select('account_id, meta_app_secret, phone_number_id, meta_token')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle()
      : { data: null }

  const accountSecret = botConn?.meta_app_secret ? decryptToken(botConn.meta_app_secret) : null

  // O número financeiro pode estar num App Meta diferente do App único da
  // MedScale. Como ele não tem account, o secret vem de env var própria,
  // caindo em META_APP_SECRET quando não configurada.
  const financeSecret = isFinanceNumber
    ? (process.env.FINANCE_META_APP_SECRET ?? process.env.META_APP_SECRET)
    : null

  const validSignature =
    validateMetaSignature(rawBody, signature, process.env.META_APP_SECRET) ||
    validateMetaSignature(rawBody, signature, accountSecret) ||
    validateMetaSignature(rawBody, signature, financeSecret)

  if (!validSignature) {
    console.warn('[whatsapp webhook] signature validation failed', {
      phoneNumberId: phoneNumberId ?? null,
      isFinanceNumber,
      accountId: botConn?.account_id ?? null,
      hasAccountSecret: Boolean(accountSecret),
      hasGlobalSecret: Boolean(process.env.META_APP_SECRET),
      hasFinanceSecret: Boolean(process.env.FINANCE_META_APP_SECRET),
      hasSignatureHeader: Boolean(signature),
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!value?.messages) {
    return NextResponse.json({ status: 'ignored' })
  }

  const message = value.messages[0]
  const from = message.from // telefone do paciente (ou do owner, no fluxo financeiro)
  const text = message.type === 'text' ? message.text.body : null

  // Mensagem no número financeiro dedicado da MedScale — fora do modelo de
  // account/bot, tratada antes da resolução abaixo.
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

  // Log do webhook para debugging. workspace_id fica null: a unidade só é
  // conhecida depois que a Maria pergunta ao paciente.
  const { data: webhookLog } = await supabase
    .from('webhook_logs')
    .insert({ workspace_id: null, payload: body })
    .select('id')
    .single()

  if (!botConn) {
    return NextResponse.json({ status: 'account_not_found' })
  }

  const accountId = botConn.account_id

  // A Meta exige resposta em <20s — o processamento roda após a resposta HTTP.
  after(async () => {
    // Rate limiting por (account, número) ANTES de qualquer processamento.
    const rateLimit = await checkRateLimit(accountId, from)
    if (!rateLimit.allowed) {
      if (rateLimit.shouldNotify && botConn.phone_number_id && botConn.meta_token) {
        await sendWhatsAppMessage({
          to: from,
          message: RATE_LIMIT_NOTICE_MESSAGE,
          phoneNumberId: botConn.phone_number_id,
          token: decryptToken(botConn.meta_token),
        }).catch((err) => console.error('[whatsapp webhook] rate limit notice failed', err))
      }
      return
    }

    if (text) {
      await processIncomingMessage({
        accountId,
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
    } else {
      await handleUnsupportedMessage({
        accountId,
        patientPhone: from,
        messageType: message.type,
        whatsappMessageId: message.id,
      }).catch((err) => console.error('handleUnsupportedMessage failed', err))
    }
  })

  return NextResponse.json({ status: 'ok' })
}

// Verificação do webhook pela Meta (handshake inicial de configuração).
// Aceita tanto o META_VERIFY_TOKEN global (App único da MedScale) quanto um
// webhook_verify_token específico de uma account que traz seu próprio App Meta.
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

  console.warn('[whatsapp webhook] verify failed: token did not match META_VERIFY_TOKEN nor any bot_config', {
    metaVerifyTokenConfigured: Boolean(process.env.META_VERIFY_TOKEN),
    tokenLength: token.length,
  })

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
