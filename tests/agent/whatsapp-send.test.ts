import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'

function lastSentBody(fetchMock: ReturnType<typeof vi.fn>): { text: { body: string } } {
  return JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
}

describe('sendWhatsAppMessage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  const params = { to: '+5511999999999', phoneNumberId: '123', token: 't' }

  it('traduz o markdown do agente para o negrito do WhatsApp', async () => {
    await sendWhatsAppMessage({ ...params, message: '• **Unidade Principal** - Av. Paulista' })
    expect(lastSentBody(fetchMock).text.body).toBe('• *Unidade Principal* - Av. Paulista')
  })

  it('entrega texto sem marcação inalterado', async () => {
    await sendWhatsAppMessage({ ...params, message: 'Qual você escolhe?' })
    expect(lastSentBody(fetchMock).text.body).toBe('Qual você escolhe?')
  })
})
