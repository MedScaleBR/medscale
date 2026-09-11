export const FEEDBACK_PROMPT_INTERVAL_DAYS = 15
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000

const DAY_MS = 24 * 60 * 60 * 1000

// O balão volta 15 dias depois da última interação — tanto faz se a pessoa
// mandou uma mensagem ou respondeu "agora não". Perfil sem marca nenhuma
// (conta criada antes da migração) vê o balão na próxima visita.
export function shouldShowFeedbackPrompt({
  dismissedAt,
  now = new Date(),
}: {
  dismissedAt: string | null
  now?: Date
}): boolean {
  if (!dismissedAt) return true

  const dismissed = new Date(dismissedAt)
  if (Number.isNaN(dismissed.getTime())) return true

  return now.getTime() - dismissed.getTime() >= FEEDBACK_PROMPT_INTERVAL_DAYS * DAY_MS
}

export type FeedbackMessageValidation =
  | { ok: true; message: string }
  | { ok: false; error: string }

export function validateFeedbackMessage(input: unknown): FeedbackMessageValidation {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Mensagem é obrigatória' }
  }

  const message = input.trim()
  if (!message) {
    return { ok: false, error: 'Mensagem é obrigatória' }
  }
  if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Mensagem deve ter no máximo ${FEEDBACK_MESSAGE_MAX_LENGTH} caracteres` }
  }

  return { ok: true, message }
}
