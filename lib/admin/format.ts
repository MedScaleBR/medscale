// Formatadores compartilhados pelas telas do /admin. Moeda: use formatBRL de
// lib/finance/summary.

export function initialsFrom(fullName: string | null | undefined, email?: string | null): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const local = (email ?? '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '')
  return local.slice(0, 2).toUpperCase() || '?'
}

// dd/MM/yyyy no fuso de São Paulo. Datas puras (YYYY-MM-DD, ex. due_date) não
// passam por fuso — senão viram o dia anterior.
export function formatDateBR(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  }
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
