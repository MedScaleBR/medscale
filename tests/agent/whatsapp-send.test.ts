import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendReminderTemplate, sendTemplateMessage, sendWhatsAppMessage } from '@/lib/whatsapp/send'

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

describe('sendTemplateMessage', () => {
  const fetchMock = vi.fn()
  const base = { to: '5571999990000', phoneNumberId: '123', token: 't', templateName: 'solicitacao_agendamento', parameters: ['16/10'] }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('envia o template na versão do Graph com idioma pt_BR', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })
    const result = await sendTemplateMessage(base)
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v22.0/123/messages')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.template.language).toEqual({ code: 'pt_BR' })
    expect(body.template.components[0].parameters[0]).toEqual({ type: 'text', text: '16/10' })
    expect(result.messages?.[0].id).toBe('wamid.1')
  })

  it('erro não ecoa corpo nem parâmetros', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'bad 16/10' } }) })
    const err = await sendTemplateMessage(base).catch((e) => e as Error)
    expect((err as Error).message).toBe('WhatsApp API error: 400')
    expect((err as Error).message).not.toContain('16/10')
  })
})
