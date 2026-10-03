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

// dd/MM/yyyy HH:mm no fuso de São Paulo — determinístico entre servidor e
// navegador (evita mismatch de hidratação).
export function formatDateTimeBR(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
}
