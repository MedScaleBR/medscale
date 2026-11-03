// E-mails da unidade que recebem as solicitações de agendamento
// (workspaces.notification_emails). Só a equipe MedScale edita, no /admin.
// Arquivo puro: usado pela rota e pela tela.

export const NOTIFICATION_EMAILS_MAX = 5

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Valida a lista: formato, no máximo 5, sem repetição (sem diferenciar maiúsculas). */
export function parseNotificationEmails(
  raw: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Lista de e-mails inválida.' }
  const emails: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'Lista de e-mails inválida.' }
    const email = item.trim().toLowerCase()
    if (!email) continue
    if (email.length > 254 || !EMAIL.test(email)) return { ok: false, error: `E-mail inválido: ${item.trim()}` }
    if (!emails.includes(email)) emails.push(email)
  }
  if (emails.length > NOTIFICATION_EMAILS_MAX) {
    return { ok: false, error: `Cadastre no máximo ${NOTIFICATION_EMAILS_MAX} e-mails.` }
  }
  return { ok: true, value: emails }
}

/** Texto livre (um por linha, ou separados por vírgula/ponto e vírgula) → lista. */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
}
