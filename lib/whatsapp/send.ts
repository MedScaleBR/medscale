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
  appointmentDate: string
  appointmentTime: string
  address: string
}

// Mensagens iniciadas pelo sistema (fora da janela de 24h) precisam usar
// um template aprovado pela Meta — texto livre é rejeitado pela API.
export async function sendReminderTemplate({
  to,
  phoneNumberId,
  token,
  patientName,
  appointmentDate,
  appointmentTime,
  address,
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
            // Ordem das variáveis do template: {{1}} nome, {{2}} data,
            // {{3}} horário, {{4}} endereço.
            parameters: [
              { type: 'text', text: patientName },
              { type: 'text', text: appointmentDate },
              { type: 'text', text: appointmentTime },
              { type: 'text', text: address },
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

interface SendWaitlistSpecificParams {
  to: string
  phoneNumberId: string
  token: string
  patientName: string
  workspaceName: string
  slot: string // "quarta-feira, 16/09 às 15:00" | "quarta-feira, 16/09 — 14:00, 15:30"
}

// Aviso de vaga para quem entrou na lista de espera pela Clara — nomeia o
// dia/horário específico que a pessoa queria. Template aprovado pela Meta.
export async function sendWaitlistSpecificTemplate({
  to,
  phoneNumberId,
  token,
  patientName,
  workspaceName,
  slot,
}: SendWaitlistSpecificParams) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'waitlist_slot_specific',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: patientName },
              { type: 'text', text: workspaceName },
              { type: 'text', text: slot },
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
