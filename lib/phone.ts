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

// Chave canônica de telefone, para comparar o `from` da Meta com o que está
// em profiles.phone. Precisa absorver duas diferenças independentes:
//
//  1. Formato — a Meta manda só dígitos em formato internacional
//     ("5561995704956"), profiles.phone costuma vir local e com máscara
//     ("(61) 99570-4956"). Abaixo de 12 dígitos assume-se Brasil e prefixa 55.
//
//  2. Nono dígito — a Meta é inconsistente com o 9 dos celulares brasileiros
//     e frequentemente o omite (o próprio número financeiro é devolvido pela
//     API como "+55 61 9570-4956"). Por isso a chave usa só os 8 últimos
//     dígitos, que são estáveis nas duas formas.
//
// Resultado: 55 + DDD + 8 dígitos finais.
//
// Assume Brasil por definição: com 11 dígitos ou menos não há como
// distinguir um celular BR sem código do país ("61995704956") de um número
// estrangeiro com ele ("14155550123" = +1 415 555 0123), e os dois viram
// chave brasileira. É aceitável porque profiles.phone é preenchido por
// médicos no Brasil, em formato local — mas um owner com telefone
// estrangeiro não seria reconhecido por este agente.
export function brazilianPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountry = digits.length <= 11 ? `55${digits}` : digits

  if (withCountry.startsWith('55') && withCountry.length >= 12) {
    return `55${withCountry.slice(2, 4)}${withCountry.slice(-8)}`
  }

  return withCountry
}
