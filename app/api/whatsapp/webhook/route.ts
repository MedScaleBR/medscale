import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { processIncomingMessage } from '@/lib/llm/agent'

// Valida a assinatura HMAC enviada pela Meta para garantir que o payload
// realmente veio da Meta e não foi forjado.
function validateMetaSignature(payload: string, signature: string): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha256', process.env.META_APP_SECRET!).update(payload).digest('hex')
  const expectedSig = `sha256=${expected}`
  if (expectedSig.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256') ?? ''

  if (!validateMetaSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody)
  const supabase = createAdminClient()

  const entry = body?.entry?.[0]
  const changes = entry?.changes?.[0]
  const value = changes?.value

  if (!value?.messages) {
    return NextResponse.json({ status: 'ignored' })
  }

  const message = value.messages[0]
  const phoneNumberId = value.metadata.phone_number_id
  const from = message.from // telefone do paciente
  const text = message.type === 'text' ? message.text.body : null

  // Encontrar a workspace pelo phone_number_id
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name, account_id')
    .eq('phone_number_id', phoneNumberId)
    .single()

  // Log do webhook para debugging — associado à workspace quando identificável
  await supabase.from('webhook_logs').insert({ workspace_id: workspace?.id ?? null, payload: body })

  if (!workspace || !text) {
    return NextResponse.json({ status: workspace ? 'ignored' : 'workspace_not_found' })
  }

  // A Meta exige resposta em <20s — o processamento do LLM roda após a
  // resposta HTTP ser enviada, via `after()` (equivalente a waitUntil no Vercel).
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
      await supabase
        .from('webhook_logs')
        .update({ error: String(err) })
        .eq('workspace_id', workspace.id)
        .order('received_at', { ascending: false })
        .limit(1)
    })
  )

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
