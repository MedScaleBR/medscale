import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  exchanged: [] as unknown[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/meta/ads-oauth', () => ({
  exchangeAdsCodeAndSave: (...args: unknown[]) => {
    g.exchanged.push(args)
    return Promise.resolve()
  },
}))

import { GET } from '@/app/api/meta/ads/callback/route'

// O connect grava o cookie de nonce como `${accountId}:${nonce}` — ver
// app/api/meta/ads/connect/route.ts. Os testes que exercitam o caminho feliz
// (ou o mismatch deliberado do nonce) precisam simular esse cookie porque o
// `state` do OAuth sozinho (accountId puro) não é mais suficiente.
const validNonceCookie = (accountId: string) => `meta_ads_oauth_nonce=${accountId}:nonce-valido`

const call = (qs: string, cookie?: string) =>
  GET(
    new NextRequest(`http://localhost/api/meta/ads/callback${qs}`, {
      headers: cookie ? { cookie } : undefined,
    })
  )

beforeEach(() => {
  g.exchanged = []
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.medscalebr.com')
})

describe('GET /api/meta/ads/callback', () => {
  it('salva a conexão quando o usuário é membro ativo da account do state e o nonce bate', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: { account_id: 'acc1' }, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await call('?code=c1&state=acc1', validNonceCookie('acc1'))

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=connected')
    expect(g.exchanged).toEqual([['c1', 'acc1', 'u1']])

    // Nonce de uso único: a resposta precisa apagar o cookie (Expires no passado).
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/meta_ads_oauth_nonce=;/)
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/)
  })

  it('recusa state de account da qual o usuário não é membro', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: null, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await call('?code=c1&state=acc-de-outro', validNonceCookie('acc-de-outro'))

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
    expect(g.exchanged).toEqual([])
  })

  it('manda para o login quando não há sessão', async () => {
    g.supabase = createSupabaseMock()
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: null } })

    const res = await call('?code=c1&state=acc1')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/login')
  })

  it('erro devolvido pela Meta vira redirect de erro', async () => {
    g.supabase = createSupabaseMock()

    const res = await call('?error=access_denied')

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
  })

  // Emenda (review da Task 7): o `state` é só o accountId puro. Um atacante
  // completa o consentimento dele mesmo, pega um `code` válido, e monta esta
  // mesma URL com o accountId da vítima. A sessão da vítima é legítima e é
  // membro do accountId — sem o nonce, o token do atacante ficaria gravado na
  // conta da vítima (login-CSRF). O nonce ausente ou divergente tem que
  // barrar isso ANTES de qualquer troca de código.
  it('recusa quando o cookie de nonce está ausente, mesmo com sessão e membership válidas', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: { account_id: 'acc1' }, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await call('?code=c1&state=acc1') // sem cookie

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
    expect(g.exchanged).toEqual([])
  })

  it('recusa quando o cookie de nonce diverge do state (nonce de outra account)', async () => {
    g.supabase = createSupabaseMock({ memberships: { select: { data: { account_id: 'acc1' }, error: null } } })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    // Cookie válido, mas mintado para outra account — não pode validar o state=acc1.
    const res = await call('?code=c1&state=acc1', validNonceCookie('acc-de-outro'))

    expect(res.headers.get('location')).toBe('https://app.medscalebr.com/configuracoes?meta_ads=error')
    expect(g.exchanged).toEqual([])
  })
})
