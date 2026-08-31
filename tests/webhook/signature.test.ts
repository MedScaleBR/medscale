import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  afterCallbacks: [] as Array<() => unknown>,
  processIncomingMessage: null as unknown as MockFn,
  handleUnsupportedMessage: null as unknown as MockFn,
  processFinancialMessage: null as unknown as MockFn,
  sendFinanceReply: null as unknown as MockFn,
}))

// `after()` só funciona dentro de um request scope do Next — aqui ele é
// substituído por uma fila, o que também permite executar o processamento
// em background e verificar o que ele recebeu.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => g.afterCallbacks.push(fn) }
})
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/llm/agent', () => ({
  processIncomingMessage: (...args: unknown[]) => g.processIncomingMessage(...args),
  handleUnsupportedMessage: (...args: unknown[]) => g.handleUnsupportedMessage(...args),
}))
vi.mock('@/lib/finance/agent', () => ({
  processFinancialMessage: (...args: unknown[]) => g.processFinancialMessage(...args),
  sendFinanceReply: (...args: unknown[]) => g.sendFinanceReply(...args),
}))
vi.mock('@/lib/finance/respond', () => ({ buildUnsupportedTypeMessage: () => 'Só entendo texto.' }))
// Token guardado criptografado no banco — o prefixo "enc:" imita isso.
vi.mock('@/lib/crypto', () => ({
  decryptToken: (t: string) => t.replace(/^enc:/, ''),
  encryptToken: (t: string) => `enc:${t}`,
}))

import { POST, GET } from '@/app/api/whatsapp/webhook/route'

const GLOBAL_SECRET = 'global-app-secret'
const WORKSPACE_SECRET = 'account-own-app-secret'
const PHONE_NUMBER_ID = 'pn-clinica-1'

// Conexão WhatsApp da account (bot_config) — resolvida pelo phone_number_id.
const BOT_CONN_ROW = {
  account_id: 'acc1',
  meta_app_secret: `enc:${WORKSPACE_SECRET}`,
  phone_number_id: PHONE_NUMBER_ID,
  meta_token: 'enc:token-da-conta',
}

// O HMAC é calculado sobre o BODY BRUTO (a string exata), nunca sobre o
// objeto JavaScript — reserializar o JSON produziria outra string e outro
// hash. Por isso o corpo circula como string em todo o teste.
function makeSignature(body: string, secret: string) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function textMessagePayload(phoneNumberId = PHONE_NUMBER_ID) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ from: '5511988887777', id: 'wamid.1', type: 'text', text: { body: 'Oi, quero marcar' } }],
            },
          },
        ],
      },
    ],
  })
}

function makeRequest(rawBody: string, signature?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (signature !== undefined) headers.set('x-hub-signature-256', signature)
  return new Request('https://app.test/api/whatsapp/webhook', { method: 'POST', body: rawBody, headers })
}

function setupSupabase(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    webhook_logs: { insert: { data: { id: 'log-1' } } },
    bot_config: { select: { data: BOT_CONN_ROW } },
    ...config,
  })
  return g.supabase
}

async function runAfterCallbacks() {
  const callbacks = [...g.afterCallbacks]
  g.afterCallbacks.length = 0
  for (const cb of callbacks) await cb()
}

describe('POST /api/whatsapp/webhook — validação de assinatura HMAC', () => {
  beforeEach(() => {
    setupSupabase()
    g.afterCallbacks = []
    g.processIncomingMessage = vi.fn(async () => undefined)
    g.handleUnsupportedMessage = vi.fn(async () => undefined)
    g.processFinancialMessage = vi.fn(async () => undefined)
    g.sendFinanceReply = vi.fn(async () => undefined)
    process.env.META_APP_SECRET = GLOBAL_SECRET
    delete process.env.FINANCE_PHONE_NUMBER_ID
    delete process.env.FINANCE_META_APP_SECRET
  })

  it('deve retornar 200 quando a assinatura é válida com o META_APP_SECRET global', async () => {
    const body = textMessagePayload()
    const res = await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
  })

  it('deve retornar 200 quando a assinatura é válida com o meta_app_secret da workspace (número próprio)', async () => {
    const body = textMessagePayload()
    // Sem o secret global configurado: só o App da própria clínica assina.
    process.env.META_APP_SECRET = 'outro-secret-que-nao-assinou'
    const res = await POST(makeRequest(body, makeSignature(body, WORKSPACE_SECRET)) as never)

    expect(res.status).toBe(200)
  })

  it('deve retornar 401 quando a assinatura está ausente no header', async () => {
    const body = textMessagePayload()
    const res = await POST(makeRequest(body) as never)

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' })
  })

  it('deve retornar 401 quando a assinatura foi gerada com o secret errado', async () => {
    const body = textMessagePayload()
    const res = await POST(makeRequest(body, makeSignature(body, 'secret-errado')) as never)

    expect(res.status).toBe(401)
  })

  it('deve retornar 401 quando o corpo foi alterado depois de assinado', async () => {
    const body = textMessagePayload()
    const signature = makeSignature(body, GLOBAL_SECRET)
    const adulterado = body.replace('Oi, quero marcar', 'Cancela tudo')
    const res = await POST(makeRequest(adulterado, signature) as never)

    expect(res.status).toBe(401)
  })

  it('deve retornar 401 quando a assinatura tem tamanho diferente do esperado', async () => {
    // timingSafeEqual lança se os buffers tiverem tamanhos diferentes — a
    // rota precisa comparar o tamanho antes, sem estourar erro 500.
    const body = textMessagePayload()
    const res = await POST(makeRequest(body, 'sha256=abc') as never)

    expect(res.status).toBe(401)
  })

  it('não deve processar a mensagem quando a assinatura é inválida', async () => {
    const body = textMessagePayload()
    await POST(makeRequest(body, makeSignature(body, 'secret-errado')) as never)
    await runAfterCallbacks()

    expect(g.processIncomingMessage).not.toHaveBeenCalled()
  })

  it('deve retornar 400 quando o corpo não é um JSON válido', async () => {
    const res = await POST(makeRequest('isto não é json', makeSignature('isto não é json', GLOBAL_SECRET)) as never)

    expect(res.status).toBe(400)
  })
})

describe('POST /api/whatsapp/webhook — roteamento da mensagem', () => {
  beforeEach(() => {
    setupSupabase()
    g.afterCallbacks = []
    g.processIncomingMessage = vi.fn(async () => undefined)
    g.handleUnsupportedMessage = vi.fn(async () => undefined)
    g.processFinancialMessage = vi.fn(async () => undefined)
    g.sendFinanceReply = vi.fn(async () => undefined)
    process.env.META_APP_SECRET = GLOBAL_SECRET
    delete process.env.FINANCE_PHONE_NUMBER_ID
  })

  it('deve gravar em webhook_logs e descartar silenciosamente quando o phone_number_id não está mapeado', async () => {
    const supabase = setupSupabase({ bot_config: { select: { data: null } } })
    const body = textMessagePayload('pn-desconhecido')
    const res = await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'account_not_found' })
    const log = supabase.callsTo('webhook_logs', 'insert')[0]
    expect(log?.payload).toMatchObject({ workspace_id: null })
    await runAfterCallbacks()
    expect(g.processIncomingMessage).not.toHaveBeenCalled()
  })

  it('deve encaminhar a mensagem de texto para processIncomingMessage com a account resolvida', async () => {
    const body = textMessagePayload()
    await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)
    await runAfterCallbacks()

    expect(g.processIncomingMessage).toHaveBeenCalledWith({
      accountId: 'acc1',
      patientPhone: '5511988887777',
      message: 'Oi, quero marcar',
      whatsappMessageId: 'wamid.1',
    })
  })

  it('deve encaminhar mensagem de áudio para handleUnsupportedMessage', async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [{ from: '5511988887777', id: 'wamid.2', type: 'audio' }],
              },
            },
          ],
        },
      ],
    })
    await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)
    await runAfterCallbacks()

    expect(g.handleUnsupportedMessage).toHaveBeenCalledWith(expect.objectContaining({ messageType: 'audio' }))
    expect(g.processIncomingMessage).not.toHaveBeenCalled()
  })

  it('deve ignorar payload sem mensagens (ex: status de entrega)', async () => {
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ status: 'read' }] } }] }],
    })
    const res = await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)

    await expect(res.json()).resolves.toEqual({ status: 'ignored' })
  })

  it('deve registrar o erro na própria linha de webhook_logs quando o processamento falha', async () => {
    const supabase = setupSupabase()
    g.processIncomingMessage = vi.fn(async () => {
      throw new Error('boom')
    })
    const body = textMessagePayload()
    await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)
    await runAfterCallbacks()

    const update = supabase.callsTo('webhook_logs', 'update')[0]
    expect(String((update?.payload as { error: string }).error)).toContain('boom')
    expect(update?.filters).toContainEqual(['eq', 'id', 'log-1'])
  })

  it('deve rotear para o agente financeiro quando o número é o FINANCE_PHONE_NUMBER_ID', async () => {
    process.env.FINANCE_PHONE_NUMBER_ID = 'pn-financeiro'
    const body = textMessagePayload('pn-financeiro')
    const res = await POST(makeRequest(body, makeSignature(body, GLOBAL_SECRET)) as never)
    await runAfterCallbacks()

    expect(res.status).toBe(200)
    expect(g.processFinancialMessage).toHaveBeenCalledWith('5511988887777', 'Oi, quero marcar')
    expect(g.processIncomingMessage).not.toHaveBeenCalled()
  })

  it('deve aceitar o FINANCE_META_APP_SECRET próprio no número financeiro', async () => {
    process.env.FINANCE_PHONE_NUMBER_ID = 'pn-financeiro'
    process.env.FINANCE_META_APP_SECRET = 'finance-secret'
    process.env.META_APP_SECRET = 'outro-secret'
    const body = textMessagePayload('pn-financeiro')
    const res = await POST(makeRequest(body, makeSignature(body, 'finance-secret')) as never)

    expect(res.status).toBe(200)
  })
})

describe('GET /api/whatsapp/webhook — handshake de verificação da Meta', () => {
  beforeEach(() => {
    // Sem match de webhook_verify_token por padrão; os testes que precisam
    // sobrescrevem bot_config.select.
    setupSupabase({ bot_config: { select: { data: null } } })
    process.env.META_VERIFY_TOKEN = 'verify-token-global'
  })

  function verifyRequest(params: Record<string, string>) {
    const url = new URL('https://app.test/api/whatsapp/webhook')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return new Request(url) as never
  }

  it('deve devolver o challenge quando o token global confere', async () => {
    const res = await GET(
      verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-global', 'hub.challenge': '12345' })
    )

    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('12345')
  })

  it('deve devolver o challenge quando o token é o webhook_verify_token de uma workspace', async () => {
    setupSupabase({ bot_config: { select: { data: { id: 'bc1' } } } })
    const res = await GET(
      verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-da-clinica', 'hub.challenge': '999' })
    )

    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('999')
  })

  it('deve retornar 403 quando o token não confere com nada', async () => {
    const res = await GET(
      verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-errado', 'hub.challenge': '999' })
    )

    expect(res.status).toBe(403)
  })

  it('deve retornar 403 quando hub.mode não é subscribe', async () => {
    const res = await GET(verifyRequest({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-token-global' }))

    expect(res.status).toBe(403)
  })
})
