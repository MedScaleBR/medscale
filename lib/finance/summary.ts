import type { FinanceEntry } from '@/lib/finance/types'
import type { CategoryNode } from '@/lib/finance/categories'

// Derivações da tela /finance. Ficam fora dos componentes porque a tela nova
// mostra comparação mês a mês, série de 12 meses e o previsto do ciclo de
// receita — contas que valem teste próprio.

export interface MonthPoint {
  month: string // 'YYYY-MM'
  label: string // 'set'
  receitas: number
  despesas: number
  saldo: number
}

export interface CategorySlice {
  name: string
  total: number
  /** Fração do maior item da lista (0..1) — é o que a barra preenche. */
  ratio: number
  /** Fração do total do período (0..1) — é o número em % ao lado. */
  share: number
  uncategorized: boolean
}

export interface ForecastSummary {
  /** Receitas já espelhadas do ciclo (revenue_entry_id preenchido). */
  confirmado: number
  /** Receitas do ciclo ainda não pagas, vindas de revenue_entries. */
  aConfirmar: number
  /** Receitas lançadas na mão (sem vínculo com o ciclo). */
  manual: number
  /** Quantas consultas compõem `aConfirmar`. */
  pendingCount: number
  /** confirmado / (confirmado + aConfirmar), 0..1. */
  ratio: number
}

/** Lançamento pendente do ciclo de receita, o mínimo que a tela precisa. */
export interface PendingRevenue {
  id: string
  amount: number
  entry_date: string
}

export function formatBRL(value: number, opts?: { compact?: boolean }): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    ...(opts?.compact ? { maximumFractionDigits: 0 } : {}),
  })
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  return monthKey(new Date(year, m - 1 + delta, 1))
}

/** 'Setembro de 2026' — título do seletor de mês. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const label = new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** 'set' — rótulo curto do eixo do gráfico. */
export function shortMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

/** Nome do mês sem o ano, para "Saldo de setembro". */
export function bareMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(year, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
}

export function summarizeMonth(entries: FinanceEntry[], month: string) {
  let receitas = 0
  let despesas = 0
  for (const e of entries) {
    if (!e.entry_date.startsWith(month)) continue
    if (e.direction === 'in') receitas += e.amount
    else despesas += e.amount
  }
  return { receitas, despesas, saldo: receitas - despesas }
}

/**
 * Série dos `count` meses que terminam em `endMonth` (inclusive). Meses sem
 * lançamento entram zerados para o gráfico manter 12 colunas sempre.
 */
export function buildMonthlySeries(entries: FinanceEntry[], endMonth: string, count = 12): MonthPoint[] {
  const series: MonthPoint[] = []
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i)
    const { receitas, despesas, saldo } = summarizeMonth(entries, month)
    series.push({ month, label: shortMonthLabel(month), receitas, despesas, saldo })
  }
  return series
}

/**
 * Variação percentual de `previous` para `current`. null quando não há base de
 * comparação (mês anterior zerado) — a tela esconde o selo nesse caso em vez de
 * mostrar "+∞%" ou um 0% que mente.
 */
export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

/** Média do saldo na janela — a linha "média de N meses" do card principal. */
export function averageSaldo(series: MonthPoint[]): number {
  if (series.length === 0) return 0
  return series.reduce((s, p) => s + p.saldo, 0) / series.length
}

/**
 * Quebra por categoria-raiz, maior primeiro. `roots` são as raízes já filtradas
 * pelo lado (in/out) e pelo tipo (PF/PJ); o que não casa vira "Sem categoria",
 * exceto o espelho do ciclo que guarda o nome em `category`.
 */
export function categoryBreakdown(entries: FinanceEntry[], roots: CategoryNode[]): CategorySlice[] {
  const totals = new Map<string, { total: number; uncategorized: boolean }>()
  for (const e of entries) {
    const root = roots.find((c) => c.id === e.category_id)
    const name = root?.name ?? e.category ?? 'Sem categoria'
    const uncategorized = !root && !e.category
    const prev = totals.get(name)
    totals.set(name, { total: (prev?.total ?? 0) + e.amount, uncategorized })
  }

  const slices = Array.from(totals.entries())
    .map(([name, v]) => ({ name, total: v.total, uncategorized: v.uncategorized, ratio: 0, share: 0 }))
    .sort((a, b) => b.total - a.total)

  const max = slices[0]?.total ?? 0
  const sum = slices.reduce((s, c) => s + c.total, 0)
  for (const s of slices) {
    s.ratio = max > 0 ? s.total / max : 0
    s.share = sum > 0 ? s.total / sum : 0
  }
  return slices
}

/**
 * Realizado vs. previsto do mês. `receitas` são só as entradas do mês já
 * filtradas por PF/PJ; `pending` são revenue_entries ainda não pagos.
 */
export function forecastSummary(
  receitas: FinanceEntry[],
  pending: PendingRevenue[],
  month: string
): ForecastSummary {
  let confirmado = 0
  let manual = 0
  for (const e of receitas) {
    if (e.revenue_entry_id) confirmado += e.amount
    else manual += e.amount
  }

  const doMes = pending.filter((p) => p.entry_date.startsWith(month))
  const aConfirmar = doMes.reduce((s, p) => s + p.amount, 0)
  const totalCiclo = confirmado + aConfirmar

  return {
    confirmado,
    aConfirmar,
    manual,
    pendingCount: doMes.length,
    ratio: totalCiclo > 0 ? confirmado / totalCiclo : 0,
  }
}
