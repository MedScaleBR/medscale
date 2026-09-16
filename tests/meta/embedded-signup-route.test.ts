import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] },
  steps: [] as string[],
  failOn: null as string | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})
vi.mock('@/lib/crypto', () => ({ encryptToken: (t: string) => `enc:${t}`, decryptToken: (t: string) => t }))
vi.mock('@/lib/bot/config', () => ({ invalidateBotConfigCache: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ trackBotWizardCompleted: vi.fn() }))

const step = async (name: string, value?: unknown) => {
  g.steps.push(name)
  if (g.failOn === name) throw new Error(`falhou em ${name}`)
  return value
}

vi.mock('@/lib/meta/embedded-signup', () => ({
  isEmbeddedSignupConfigured: () => true,
  exchangeEmbeddedSignupCode: () => step('exchange', 'token-negocio'),
  subscribeAppToWaba: () => step('subscribe'),
  registerPhoneNumber: () => step('register'),
  fetchPhoneNumberInfo: () => step('info', { displayPhoneNumber: '+55 11 98888-0000', verifiedName: 'Clínica X' }),
  generatePin: () => '123456',
}))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'

const req = () =>
  new NextRequest('http://localhost/api/whatsapp/embedded-signup', {
    method: 'POST',
    body: JSON.stringify({ code: 'c1', waba_id: 'waba-1', phone_number_id: 'pn-1' }),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  g.steps = []
  g.failOn = null
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  g.supabase = createSupabaseMock({
    bot_config: { upsert: { data: { id: 'bc1' }, error: null } },
  })
})

describe('POST /api/whatsapp/embedded-signup', () => {
  it('executa os quatro passos da Meta na ordem e salva a conexão ativa', async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(g.steps).toEqual(['exchange', 'subscribe', 'register', 'info'])

    const upsert = g.supabase.callsTo('bot_config', 'upsert')[0]
    expect(upsert.payload).toMatchObject({
      account_id: 'acc1',
      waba_id: 'waba-1',
      phone_number_id: 'pn-1',
      meta_token: 'enc:token-negocio',
      whatsapp_pin: 'enc:123456',
      whatsapp_number: '+55 11 98888-0000',
      is_active: true,
      number_source: 'own',
    })
  })

  it('falha na inscrição do App não persiste conexão nenhuma', async () => {
    g.failOn = 'subscribe'

    const res = await POST(req())

    expect(res.status).toBe(400)
    expect(g.steps).toEqual(['exchange', 'subscribe'])
    expect(g.supabase.callsTo('bot_config', 'upsert')).toHaveLength(0)
  })

  it('member recebe 403', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await POST(req())

    expect(res.status).toBe(403)
    expect(g.steps).toEqual([])
  })

  it('exige code, waba_id e phone_number_id', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/whatsapp/embedded-signup', {
        method: 'POST',
        body: JSON.stringify({ code: 'c1' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(res.status).toBe(400)
  })
})
