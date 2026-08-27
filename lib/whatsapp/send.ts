interface SendMessageParams {
  to: string // formato E.164: +5511999999999
  message: string
  phoneNumberId: string
  token: string
}

export async function sendWhatsAppMessage({ to, message, phoneNumberId, token }: SendMessageParams) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: message },
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
  }

  return response.json()
}

interface SendReminderParams {
  to: string
  phoneNumberId: string
  token: string
  patientName: string
  workspaceName: string
  appointmentDate: string
}

// Mensagens iniciadas pelo sistema (fora da janela de 24h) precisam usar
// um template aprovado pela Meta — texto livre é rejeitado pela API.
export async function sendReminderTemplate({
  to,
  phoneNumberId,
  token,
  patientName,
  workspaceName,
  appointmentDate,
}: SendReminderParams) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'appointment_reminder_2', // template aprovado pela Meta
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: patientName },
              { type: 'text', text: workspaceName },
              { type: 'text', text: appointmentDate },
            ],
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
  }

  return response.json()
}

interface SendWaitlistParams {
  to: string
  phoneNumberId: string
  token: string
  patientName: string
  workspaceName: string
  slots: string
}

// Aviso de vaga aberta para quem está na lista de espera — também iniciado
// pelo sistema fora da janela de 24h, precisa de template aprovado pela Meta.
export async function sendWaitlistTemplate({
  to,
  phoneNumberId,
  token,
  patientName,
  workspaceName,
  slots,
}: SendWaitlistParams) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'waitlist_slot_available', // template aprovado pela Meta
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: patientName },
              { type: 'text', text: workspaceName },
              { type: 'text', text: slots },
            ],
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
  }

  return response.json()
}
