import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendReminderTemplate, sendWhatsAppMessage } from '@/lib/whatsapp/send'

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

  it('vincula o botão de confirmação à consulta no lembrete', async () => {
    await sendReminderTemplate({ ...params, appointmentId: '11111111-1111-4111-8111-111111111111', patientName: 'Ana', appointmentDate: '03/10/2026', appointmentTime: '11:00', address: 'Rua A' })
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
    expect(body.template.components).toContainEqual({
      type: 'button', sub_type: 'quick_reply', index: '0',
      parameters: [{ type: 'payload', payload: 'confirm_appointment:11111111-1111-4111-8111-111111111111' }],
    })
    expect(body.template.components[0].parameters.map((parameter: { text: string }) => parameter.text)).toEqual(['Ana', '03/10/2026', '11:00', 'Rua A'])
  })

  it('traduz o markdown do agente para o negrito do WhatsApp', async () => {
    await sendWhatsAppMessage({ ...params, message: '• **Unidade Principal** - Av. Paulista' })
    expect(lastSentBody(fetchMock).text.body).toBe('• *Unidade Principal* - Av. Paulista')
  })

  it('entrega texto sem marcação inalterado', async () => {
    await sendWhatsAppMessage({ ...params, message: 'Qual você escolhe?' })
    expect(lastSentBody(fetchMock).text.body).toBe('Qual você escolhe?')
  })
})
