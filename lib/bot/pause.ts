// Pausa da Clara numa conversa.
//
// Dois tipos:
// - bot_paused: pausa até a equipe reativar pelo painel (handoff, resposta
//   manual pelo painel).
// - bot_paused_until: pausa temporária. Usada quando a secretária responde o
//   paciente pelo app do WhatsApp Business no celular (coexistência). Cada
//   nova resposta dela empurra o prazo.

export const SECRETARY_PAUSE_HOURS = 4

export function isBotPaused(
  conversation: { bot_paused: boolean; bot_paused_until?: string | null },
  now: Date = new Date()
): boolean {
  if (conversation.bot_paused) return true
  if (!conversation.bot_paused_until) return false
  return new Date(conversation.bot_paused_until).getTime() > now.getTime()
}

export function secretaryPauseUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + SECRETARY_PAUSE_HOURS * 60 * 60 * 1000).toISOString()
}

// Saudação/ausência automática do app WhatsApp Business: sai do celular segundos
// depois da mensagem do paciente e também chega como echo. Ninguém digita tão
// rápido, então um echo nessa janela não é a secretária e não pausa a Clara.
export const AUTO_REPLY_WINDOW_SECONDS = 10

export function isAutoReply(echoAt: Date, patientMessageAt: Date): boolean {
  const diff = echoAt.getTime() - patientMessageAt.getTime()
  // -1s de folga: o timestamp da Meta vem em segundos inteiros.
  return diff >= -1000 && diff <= AUTO_REPLY_WINDOW_SECONDS * 1000
}

// Timestamp da Meta: segundos Unix em string ("1762431628").
export function parseMetaTimestamp(value: unknown): Date | null {
  const seconds = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

// Quando o echo foi gravado, a partir do prazo da pausa que ele criou.
export function echoTimeFromPause(pausedUntil: string): Date {
  return new Date(new Date(pausedUntil).getTime() - SECRETARY_PAUSE_HOURS * 60 * 60 * 1000)
}

// Mensagem que a clínica mandou pelo celular (webhook smb_message_echoes).
export interface BusinessEcho {
  patientPhone: string
  whatsappMessageId: string | null
  // Texto a salvar na conversa. null para apagar/editar mensagem: a Clara
  // pausa, mas nada novo entra no histórico.
  content: string | null
}

const MEDIA_LABELS: Record<string, string> = {
  image: '[Imagem enviada pelo celular]',
  video: '[Vídeo enviado pelo celular]',
  document: '[Documento enviado pelo celular]',
  audio: '[Áudio enviado pelo celular]',
  sticker: '[Figurinha enviada pelo celular]',
}

export function parseBusinessEcho(echo: unknown): BusinessEcho | null {
  if (!echo || typeof echo !== 'object') return null
  const e = echo as Record<string, unknown>
  const to = typeof e.to === 'string' ? e.to.replace(/\D/g, '') : ''
  if (!to) return null
  const type = typeof e.type === 'string' ? e.type : ''
  const whatsappMessageId = typeof e.id === 'string' ? e.id : null

  let content: string | null = null
  if (type === 'text') {
    const body = (e.text as { body?: unknown } | undefined)?.body
    content = typeof body === 'string' && body.trim() ? body : null
  } else if (MEDIA_LABELS[type]) {
    const caption = (e[type] as { caption?: unknown } | undefined)?.caption
    const label = MEDIA_LABELS[type]
    content = typeof caption === 'string' && caption.trim() ? `${label} ${caption}` : label
  }

  return { patientPhone: to, whatsappMessageId, content }
}
