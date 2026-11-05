// Nome do perfil do WhatsApp de quem mandou a mensagem. A Meta manda em
// value.contacts[] (wa_id + profile.name) junto de cada mensagem recebida.

const MAX_LENGTH = 100

export function parseProfileName(contacts: unknown, from: string): string | null {
  if (!Array.isArray(contacts)) return null
  const match =
    contacts.find((c) => c && typeof c === 'object' && (c as { wa_id?: unknown }).wa_id === from) ??
    (contacts.length === 1 ? contacts[0] : null)
  const name = (match as { profile?: { name?: unknown } } | null)?.profile?.name
  if (typeof name !== 'string') return null
  // Tira caracteres de controle e espaços repetidos; corta nomes enormes.
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, MAX_LENGTH) : null
}
