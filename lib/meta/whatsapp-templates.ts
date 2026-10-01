import { graphFetch, MetaApiError } from './graph'

// Templates que o app envia fora da janela de 24h (lib/whatsapp/send.ts).
// Template é por WABA: cada clínica que conecta o próprio número precisa dos
// três no WABA dela, senão o lembrete e o aviso de vaga falham em silêncio.
// Nome, idioma e ordem das variáveis têm de bater com o que send.ts manda.

export interface WhatsAppTemplateSpec {
  name: string
  language: string
  category: 'UTILITY'
  body: string
  example: string[]
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplateSpec[] = [
  {
    // {{1}} nome, {{2}} data, {{3}} horário, {{4}} endereço
    name: 'appointment_reminder_2',
    language: 'pt_BR',
    category: 'UTILITY',
    body:
      'Olá, {{1}}! Passando para lembrar da sua consulta amanhã, dia {{2}}, às {{3}}.\n' +
      '📍 Endereço: {{4}}\n' +
      'Se precisar remarcar ou cancelar, é só responder esta mensagem.',
    example: ['Maria', '01/10/2026', '14:30', 'Av. Paulista, 1000 - São Paulo/SP'],
  },
  {
    // {{1}} nome, {{2}} unidade, {{3}} horários separados por " | "
    name: 'waitlist_slot_available',
    language: 'pt_BR',
    category: 'UTILITY',
    body:
      'Olá, {{1}}! Abriram horários na {{2}}: {{3}}.\n' +
      'Quer agendar em algum deles? Responda esta mensagem que a gente reserva pra você.',
    example: ['Maria', 'Clínica Centro', 'quarta-feira, 16/09 às 15:00 | quinta-feira, 17/09 às 10:00'],
  },
  {
    // {{1}} nome, {{2}} unidade, {{3}} a vaga pedida
    name: 'waitlist_slot_specific',
    language: 'pt_BR',
    category: 'UTILITY',
    body:
      'Olá, {{1}}! Boa notícia: abriu a vaga que você queria na {{2}}: {{3}}.\n' +
      'Quer que a gente reserve pra você? É só responder esta mensagem.',
    example: ['Maria', 'Clínica Centro', 'quarta-feira, 16/09 às 15:00'],
  },
]

export interface EnsureTemplatesResult {
  created: string[]
  existing: string[]
  failed: { name: string; error: string }[]
}

/**
 * Cria no WABA os templates que ainda não existem. Idempotente: roda de novo
 * sem duplicar. Nunca lança — falha de um template não impede os outros, e o
 * chamador decide o que fazer com `failed`.
 */
export async function ensureWhatsAppTemplates(wabaId: string, token: string): Promise<EnsureTemplatesResult> {
  const result: EnsureTemplatesResult = { created: [], existing: [], failed: [] }

  let present: Set<string>
  try {
    const data = await graphFetch<{ data?: { name: string; language: string }[] }>(`/${wabaId}/message_templates`, {
      token,
      params: { fields: 'name,language', limit: '200' },
    })
    present = new Set((data.data ?? []).map((t) => `${t.name}:${t.language}`))
  } catch (err) {
    const error = err instanceof MetaApiError ? err.message : String(err)
    return { ...result, failed: WHATSAPP_TEMPLATES.map((t) => ({ name: t.name, error })) }
  }

  for (const t of WHATSAPP_TEMPLATES) {
    if (present.has(`${t.name}:${t.language}`)) {
      result.existing.push(t.name)
      continue
    }
    try {
      await graphFetch(`/${wabaId}/message_templates`, {
        token,
        method: 'POST',
        body: {
          name: t.name,
          language: t.language,
          category: t.category,
          components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }],
        },
      })
      result.created.push(t.name)
    } catch (err) {
      result.failed.push({ name: t.name, error: err instanceof MetaApiError ? err.message : String(err) })
    }
  }

  return result
}
