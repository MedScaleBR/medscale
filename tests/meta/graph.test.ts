import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { graphFetch, MetaApiError, GRAPH_VERSION } from '@/lib/meta/graph'

describe('graphFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('monta a URL com a versão da Graph e envia o token como Bearer', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ display_phone_number: '+55 11 99999-0000' }), { status: 200 })
    )

    const data = await graphFetch<{ display_phone_number: string }>('/pn-1', {
      token: 'tok',
      params: { fields: 'display_phone_number' },
    })

    expect(data.display_phone_number).toBe('+55 11 99999-0000')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(
      `https://graph.facebook.com/${GRAPH_VERSION}/pn-1?fields=display_phone_number`
    )
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('transforma erro da Meta em MetaApiError com código', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth token', code: 190, error_subcode: 463 } }), {
        status: 401,
      })
    )

    const err = (await graphFetch('/me', { token: 'velho' }).catch((e) => e)) as MetaApiError

    expect(err).toBeInstanceOf(MetaApiError)
    expect(err.code).toBe(190)
    expect(err.subcode).toBe(463)
    expect(err.status).toBe(401)
    expect(err.isTokenExpired).toBe(true)
    expect(err.message).toContain('Invalid OAuth token')
  })

  it('não marca como token expirado um erro comum', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unsupported get request', code: 100 } }), { status: 400 })
    )

    const err = (await graphFetch('/waba-1/subscribed_apps', { token: 'tok' }).catch((e) => e)) as MetaApiError

    expect(err.isTokenExpired).toBe(false)
  })

  it('manda body como form-urlencoded no POST', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))

    await graphFetch('/pn-1/register', {
      token: 'tok',
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin: '123456' },
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toBe('messaging_product=whatsapp&pin=123456')
  })
})
