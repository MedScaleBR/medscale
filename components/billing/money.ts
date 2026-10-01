// Dinheiro do faturamento é sempre em centavos (int). Estes helpers convertem
// para/de texto sem passar por float.

export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const reais = Math.floor(abs / 100).toLocaleString('pt-BR')
  return `${cents < 0 ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`
}

// "150", "150,5", "150,50", "1.234,56" → centavos; null se inválido.
export function parseCents(input: string): number | null {
  const clean = input.trim().replace(/^R\$\s*/, '').replace(/\./g, '')
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(clean)
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}
