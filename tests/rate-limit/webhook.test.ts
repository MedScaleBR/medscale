import { describe, it, expect, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))

import { checkRateLimit, RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_SECONDS } from '@/lib/rate-limit/webhook'

const WORKSPACE = 'ws-1'
const PHONE = '5511988887777'

// Registro com a janela ainda aberta (window_start = agora); os overrides
// ajustam contador / flags por caso de teste.
function openWindowRow(over: Partial<{ message_count: number; notified: boolean; blocked_at: string | null }> = {}) {
  return { window_start: new Date().toISOString(), message_count: 1, notified: false, blocked_at: null, ...over }
}

function setup(existing: unknown) {
  g.supabase = createSupabaseMock({ rate_limit_log: { select: { data: existing } } })
  return g.supabase
}

describe('checkRateLimit', () => {
  it('permite a primeira mensagem de um número novo e abre a janela com count = 1', async () => {
    const supabase = setup(null)

    const result = await checkRateLimit(WORKSPACE, PHONE)

    expect(result).toEqual({ allowed: true })
    const upsert = supabase.callsTo('rate_limit_log', 'upsert')[0]
    expect(upsert?.payload).toMatchObject({
      account_id: WORKSPACE,
      phone: PHONE,
      message_count: 1,
      notified: false,
      blocked_at: null,
    })
  })

  it('permite e incrementa até o limite máximo dentro da janela', async () => {
    const supabase = setup(openWindowRow({ message_count: RATE_LIMIT_MAX_MESSAGES - 1 }))

    const result = await checkRateLimit(WORKSPACE, PHONE)

    expect(result).toEqual({ allowed: true })
    expect(supabase.callsTo('rate_limit_log', 'update')[0]?.payload).toEqual({
      message_count: RATE_LIMIT_MAX_MESSAGES,
    })
  })

  it('bloqueia e sinaliza notificação na primeira mensagem acima do limite', async () => {
    const supabase = setup(openWindowRow({ message_count: RATE_LIMIT_MAX_MESSAGES, notified: false }))

    const result = await checkRateLimit(WORKSPACE, PHONE)

    expect(result).toEqual({ allowed: false, shouldNotify: true })
    const update = supabase.callsTo('rate_limit_log', 'update')[0]
    expect(update?.payload).toMatchObject({ notified: true, message_count: RATE_LIMIT_MAX_MESSAGES + 1 })
    expect((update?.payload as { blocked_at: string | null }).blocked_at).toBeTruthy()
  })

  it('mantém o blocked_at original quando o bloqueio já estava ativo nesta janela', async () => {
    const firstBlockAt = new Date(Date.now() - 5_000).toISOString()
    const supabase = setup(
      openWindowRow({ message_count: RATE_LIMIT_MAX_MESSAGES + 2, notified: false, blocked_at: firstBlockAt })
    )

    await checkRateLimit(WORKSPACE, PHONE)

    expect((supabase.callsTo('rate_limit_log', 'update')[0]?.payload as { blocked_at: string }).blocked_at).toBe(
      firstBlockAt
    )
  })

  it('bloqueia sem notificar quando o aviso já foi enviado nesta janela', async () => {
    const supabase = setup(openWindowRow({ message_count: RATE_LIMIT_MAX_MESSAGES + 5, notified: true }))

    const result = await checkRateLimit(WORKSPACE, PHONE)

    expect(result).toEqual({ allowed: false, shouldNotify: false })
    expect(supabase.callsTo('rate_limit_log', 'update')[0]?.payload).toEqual({
      message_count: RATE_LIMIT_MAX_MESSAGES + 6,
    })
  })

  it('reinicia a janela quando window_start já expirou', async () => {
    const expired = new Date(Date.now() - (RATE_LIMIT_WINDOW_SECONDS + 60) * 1000).toISOString()
    const supabase = setup({ window_start: expired, message_count: 15, notified: true, blocked_at: expired })

    const result = await checkRateLimit(WORKSPACE, PHONE)

    expect(result).toEqual({ allowed: true })
    expect(supabase.callsTo('rate_limit_log', 'upsert')[0]?.payload).toMatchObject({
      message_count: 1,
      notified: false,
      blocked_at: null,
    })
    expect(supabase.callsTo('rate_limit_log', 'update')).toHaveLength(0)
  })

  it('consulta o bucket por (account_id, phone) — isolamento por tenant', async () => {
    const supabase = setup(null)

    await checkRateLimit(WORKSPACE, PHONE)

    const select = supabase.callsTo('rate_limit_log', 'select')[0]
    expect(filterValue(select!, 'eq', 'account_id')).toBe(WORKSPACE)
    expect(filterValue(select!, 'eq', 'phone')).toBe(PHONE)
  })

  it('trata accounts diferentes como buckets independentes', async () => {
    setup(null) // mesmo telefone, account diferente e ainda sem registro

    const result = await checkRateLimit('ws-2', PHONE)

    expect(result).toEqual({ allowed: true })
  })
})
