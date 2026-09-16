import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  registerPhoneNumber,
  fetchPhoneNumberInfo,
  generatePin,
} from '@/lib/meta/embedded-signup'

const ok = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })

describe('passos do Embedded Signup', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'app-123')
    vi.stubEnv('META_APP_SECRET', 'segredo')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('troca o code pelo token do negócio', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ access_token: 'token-do-negocio' }))

    const token = await exchangeEmbeddedSignupCode('code-abc')

    expect(token).toBe('token-do-negocio')
    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('/oauth/access_token')
    expect(url).toContain('client_id=app-123')
    expect(url).toContain('client_secret=segredo')
    expect(url).toContain('code=code-abc')
  })

  it('erra com mensagem em português quando a Meta recusa o código', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid verification code', code: 100 } }), { status: 400 })
    )

    await expect(exchangeEmbeddedSignupCode('ruim')).rejects.toThrow(
      /autorização do WhatsApp expirou|não foi possível concluir a autorização/i
    )
  })

  it('inscreve o App no WABA', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ success: true }))

    await subscribeAppToWaba('waba-1', 'tok')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/waba-1/subscribed_apps')
    expect(init?.method).toBe('POST')
  })

  it('registra o número com o PIN', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ success: true }))

    await registerPhoneNumber('pn-1', '123456', 'tok')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/pn-1/register')
    expect(String(init?.body)).toContain('messaging_product=whatsapp')
    expect(String(init?.body)).toContain('pin=123456')
  })

  it('lê número e nome verificado', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ display_phone_number: '+55 11 98888-0000', verified_name: 'Clínica X' }))

    const info = await fetchPhoneNumberInfo('pn-1', 'tok')

    expect(info).toEqual({ displayPhoneNumber: '+55 11 98888-0000', verifiedName: 'Clínica X' })
  })

  it('gera PIN de exatamente 6 dígitos', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePin()).toMatch(/^\d{6}$/)
    }
  })
})
