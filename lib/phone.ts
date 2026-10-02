/** Local Brazilian number; strip DDI only when the length includes it. */
function localDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits
}

/** Canonical WhatsApp number, including the implicit Brazilian DDI. */
export function normalizeBrazilianPhone(phone: unknown): string | null {
  if (typeof phone !== 'string') return null
  const digits = localDigits(phone)
  return /^\d{10,11}$/.test(digits) ? `55${digits}` : null
}

/** Also accepts partial input so the same mask can be used while typing. */
export function formatBrazilianPhone(phone: string): string {
  const digits = localDigits(phone)
  if (!digits) return ''
  if (digits.length > 11) return phone
  if (digits.length <= 2) return `(${digits}`
  const number = digits.slice(2)
  const split = number.length > 8 ? 5 : 4
  return `(${digits.slice(0, 2)}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ''}`
}
