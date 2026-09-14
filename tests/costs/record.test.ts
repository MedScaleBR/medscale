import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { recordClaudeCost, recordWhisperCost, recordWhatsappConversation } from '@/lib/costs/record'
import { USD_BRL, whatsappConversationCostBrl } from '@/lib/costs/pricing'

const CTX = { accountId: 'acc1', workspaceId: 'w1' }

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock(config)
  return g.supabase
}

/** Payload do único insert em cost_events. */
function inserted(mock: SupabaseMock) {
  const calls = mock.callsTo('cost_events', 'insert')
  expect(calls).toHaveLength(1)
  return calls[0].payload as Record<string, unknown>
}

beforeEach(() => setup())

describe('recordClaudeCost', () => {
  it('grava provider, modelo, tokens e custo em reais', async () => {
    const mock = setup()

    await recordClaudeCost({
      ctx: CTX,
      provider: 'claude_agendamento',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 1000, output_tokens: 500 },
      relatedId: 'conv1',
    })

    const row = inserted(mock)
    expect(row).toMatchObject({
      account_id: 'acc1',
      workspace_id: 'w1',
      provider: 'claude_agendamento',
      model: 'claude-sonnet-4-5',
      input_tokens: 1000,
      output_tokens: 500,
      related_id: 'conv1',
    })
    expect(row.cost_brl).toBeCloseTo(0.0105 * USD_BRL, 4)
  })

  // A etapa do agente financeiro vive em metadata de propósito: um provider só
  // (claude_financeiro) mantém o painel somando um número por agente, e a
  // quebra por etapa continua disponível sem coluna nova nem migration.
  it('guarda a etapa em metadata, sem multiplicar providers', async () => {
    const mock = setup()

    await recordClaudeCost({
      ctx: { accountId: 'acc1' },
      provider: 'claude_financeiro',
      model: 'claude-opus-5',
      usage: { input_tokens: 800, output_tokens: 200 },
      stage: 'interpret',
    })

    const row = inserted(mock)
    expect(row.provider).toBe('claude_financeiro')
    expect(row.metadata).toMatchObject({ stage: 'interpret', fx: USD_BRL })
    // workspaceId ausente vira NULL explícito — o painel tem balde "sem unidade".
    expect(row.workspace_id).toBeNull()
  })

  it('preserva o custo em USD e a cotação usada, para auditoria', async () => {
    const mock = setup()

    await recordClaudeCost({
      ctx: CTX,
      provider: 'claude_soap',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 1000, output_tokens: 500 },
      relatedId: 'tr1',
    })

    const metadata = inserted(mock).metadata as Record<string, unknown>
    expect(metadata.usd).toBeCloseTo(0.0105, 10)
    expect(metadata.fx).toBe(USD_BRL)
  })

  // Um preço de fallback silencioso é a explicação mais provável de um número
  // fora da curva no painel — precisa estar marcado na própria linha.
  it('marca unknown_model quando o preço veio do fallback', async () => {
    const mock = setup()

    await recordClaudeCost({
      ctx: CTX,
      provider: 'claude_agendamento',
      model: 'claude-modelo-novo-nao-tabelado',
      usage: { input_tokens: 100, output_tokens: 100 },
    })

    expect((inserted(mock).metadata as Record<string, unknown>).unknown_model).toBe(true)
  })

  it('não marca unknown_model num modelo conhecido', async () => {
    const mock = setup()

    await recordClaudeCost({
      ctx: CTX,
      provider: 'claude_agendamento',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 100, output_tokens: 100 },
    })

    expect((inserted(mock).metadata as Record<string, unknown>).unknown_model).toBeUndefined()
  })

  // Linha de zero token é indistinguível de uma chamada barata de verdade e
  // puxaria a média por conversa para baixo.
  it('resposta sem usage não vira linha', async () => {
    const mock = setup()

    await recordClaudeCost({ ctx: CTX, provider: 'claude_agendamento', model: 'claude-sonnet-4-5', usage: null })
    await recordClaudeCost({ ctx: CTX, provider: 'claude_agendamento', model: 'claude-sonnet-4-5', usage: undefined })
    await recordClaudeCost({
      ctx: CTX,
      provider: 'claude_agendamento',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    expect(mock.callsTo('cost_events', 'insert')).toHaveLength(0)
  })
})

describe('recordWhisperCost', () => {
  it('grava a duração como quantity e o custo pelo tempo de áudio', async () => {
    const mock = setup()

    await recordWhisperCost({ ctx: CTX, durationSeconds: 120, transcriptionId: 'tr1' })

    const row = inserted(mock)
    expect(row).toMatchObject({ provider: 'whisper', model: 'whisper-1', quantity: 120, related_id: 'tr1' })
    expect(row.cost_brl).toBeCloseTo(0.012 * USD_BRL, 4)
  })

  it('duração ausente ou zerada não vira linha', async () => {
    const mock = setup()

    await recordWhisperCost({ ctx: CTX, durationSeconds: 0, transcriptionId: 'tr1' })

    expect(mock.callsTo('cost_events', 'insert')).toHaveLength(0)
  })
})

describe('recordWhatsappConversation', () => {
  it('grava uma janela de 24h em reais, sem passar por câmbio', async () => {
    const mock = setup({ cost_events: { select: { data: null } } })

    const recorded = await recordWhatsappConversation({ ctx: CTX, conversationId: 'conv1' })

    expect(recorded).toBe(true)
    const row = inserted(mock)
    expect(row).toMatchObject({ provider: 'whatsapp_conversation', quantity: 1, related_id: 'conv1', model: null })
    expect(row.cost_brl).toBe(whatsappConversationCostBrl())
  })

  // A Meta cobra por janela, não por mensagem: a 2ª mensagem do mesmo paciente
  // dentro das 24h é gratuita, e cobrar de novo inflaria o custo da conta.
  it('não cobra de novo dentro da janela de 24h da mesma conversa', async () => {
    const mock = setup({ cost_events: { select: { data: { id: 'ce-anterior' } } } })

    const recorded = await recordWhatsappConversation({ ctx: CTX, conversationId: 'conv1' })

    expect(recorded).toBe(false)
    expect(mock.callsTo('cost_events', 'insert')).toHaveLength(0)
  })

  it('a checagem olha a mesma conversa nas últimas 24h', async () => {
    const mock = setup({ cost_events: { select: { data: null } } })

    await recordWhatsappConversation({ ctx: CTX, conversationId: 'conv1' })

    const check = mock.callsTo('cost_events', 'select')[0]
    expect(filterValue(check, 'eq', 'provider')).toBe('whatsapp_conversation')
    expect(filterValue(check, 'eq', 'related_id')).toBe('conv1')

    const since = new Date(String(filterValue(check, 'gte', 'created_at'))).getTime()
    const expected = Date.now() - 24 * 60 * 60 * 1000
    expect(Math.abs(since - expected)).toBeLessThan(5000)
  })
})

// A regra que manda em todo este módulo: custo é telemetria interna. Um
// paciente sem resposta ou um prontuário que não gera são incidentes reais;
// uma linha de custo perdida é só um número levemente baixo no painel.
describe('falha na captura nunca quebra o fluxo principal', () => {
  it('erro do banco no insert é engolido e só vai para o Sentry', async () => {
    setup({ cost_events: { insert: { error: { message: 'permission denied' } } } })

    await expect(
      recordClaudeCost({
        ctx: CTX,
        provider: 'claude_agendamento',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    ).resolves.toBeUndefined()

    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it('client do Supabase indisponível não propaga exceção', async () => {
    g.supabase = { client: { from: () => { throw new Error('sem conexão') } } } as unknown as SupabaseMock

    await expect(recordWhisperCost({ ctx: CTX, durationSeconds: 60, transcriptionId: 'tr1' })).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  // Se a checagem de duplicata falhou, não dá pra saber se a janela já foi
  // cobrada — não gravar é o erro barato, gravar duas vezes mente no painel.
  it('checagem de duplicata que falha não grava nem lança', async () => {
    g.supabase = { client: { from: () => { throw new Error('sem conexão') } } } as unknown as SupabaseMock

    await expect(recordWhatsappConversation({ ctx: CTX, conversationId: 'conv1' })).resolves.toBe(false)
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})
