import type { CategoryNode } from './categories'
import type { FinanceEntry, FinanceProjection, FinanceSuggestionDismissal } from './types'

// Usados quando a conta não tem linha em finance_suggestion_settings, o que
// evita um insert de provisionamento em toda conta que nunca abriu a aba.
// 0% na projeção: quem definiu um teto quis aquele teto. 30% na média: gasto
// real oscila, e alertar a cada 5% viraria ruído.
export const DEFAULT_TOLERANCE = { projectionPct: 0, historyPct: 30 }

// Quantos meses distintos com gasto a categoria precisa ter para a média
// valer como referência. Com 1 mês só, "média" é só aquele mês.
const MIN_MESES_DE_HISTORICO = 2

// Categoria achatada, com o que o cálculo precisa saber. Desacoplada de
// CategoryNode de propósito: esta função é pura e não deve depender da forma
// da árvore nem do banco.
export type SuggestionCategory = {
  id: string
  name: string
  parentId: string | null
  direction: 'in' | 'out'
  isEssential: boolean
}

export type Suggestion = {
  categoryId: string
  subcategoryId: string | null
  // Nome do nó avaliado (a subcategoria quando o alerta é nesse nível).
  categoryName: string
  // Caminho legível para a tela e para o WhatsApp ("Lazer > Cinema").
  categoryPath: string
  realizedAmount: number
  // A projeção ou a média histórica, conforme o caminho usado.
  referenceAmount: number
  referenceType: 'projection' | 'history_average'
  overAmount: number
  overPct: number
}

export type SuggestionContext = {
  // 'YYYY-MM' do período avaliado.
  periodMonth: string
  // Lançamentos do período corrente.
  entries: FinanceEntry[]
  // Lançamentos dos 3 meses anteriores, para o fallback de média.
  historicalEntries: FinanceEntry[]
  // Projeções do período corrente.
  projections: FinanceProjection[]
  categories: SuggestionCategory[]
  tolerance: { projectionPct: number; historyPct: number }
  dismissals: FinanceSuggestionDismissal[]
}

// Achata a árvore de categorias no formato que o cálculo consome.
export function flattenCategories(nodes: CategoryNode[]): SuggestionCategory[] {
  const out: SuggestionCategory[] = []
  for (const root of nodes) {
    out.push({
      id: root.id,
      name: root.name,
      parentId: null,
      direction: root.direction,
      isEssential: root.isEssential,
    })
    for (const sub of root.children) {
      out.push({
        id: sub.id,
        name: sub.name,
        parentId: root.id,
        direction: sub.direction,
        isEssential: sub.isEssential,
      })
    }
  }
  return out
}

// Um nível de avaliação: a categoria inteira (subcategoryId null) ou uma
// subcategoria específica.
type Unit = { categoryId: string; subcategoryId: string | null }

const unitKey = (u: Unit) => `${u.categoryId}::${u.subcategoryId ?? ''}`

// Gasto realizado no nível avaliado. Sem subcategoria, a conta cobre a
// subárvore inteira (o que foi lançado direto na categoria e o que foi
// lançado nas filhas) — é isso que "projeção de Mercado é 800" significa.
function realizedFor(entries: FinanceEntry[], unit: Unit): number {
  return entries
    .filter((e) => e.direction === 'out' && e.category_id === unit.categoryId)
    .filter((e) => (unit.subcategoryId ? e.subcategory_id === unit.subcategoryId : true))
    .reduce((sum, e) => sum + e.amount, 0)
}

// Média dos meses ANTERIORES com gasto no nível avaliado. Divide pelo número
// de meses com movimento, não por 3 fixo: uma categoria que só aparece em 2
// dos 3 meses teria a média derrubada por um zero que não é um "mês barato",
// é ausência de dado. null quando não há meses suficientes.
function historyAverage(historical: FinanceEntry[], unit: Unit): number | null {
  const byMonth = new Map<string, number>()
  for (const e of historical) {
    if (e.direction !== 'out' || e.category_id !== unit.categoryId) continue
    if (unit.subcategoryId && e.subcategory_id !== unit.subcategoryId) continue
    const month = e.entry_date.slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + e.amount)
  }
  const months = [...byMonth.values()].filter((v) => v > 0)
  if (months.length < MIN_MESES_DE_HISTORICO) return null
  return months.reduce((a, b) => a + b, 0) / months.length
}

// Quais níveis avaliar. Onde há projeção, avalia exatamente no nível dela
// (categoria ou subcategoria). Onde não há projeção nenhuma na categoria,
// avalia a categoria inteira pela média histórica. Assim o mesmo dinheiro
// nunca é cobrado em dois alertas ao mesmo tempo.
function evaluationUnits(ctx: SuggestionContext): Unit[] {
  const units: Unit[] = []
  const seen = new Set<string>()
  const withProjection = new Set<string>()

  for (const p of ctx.projections) {
    const unit = { categoryId: p.category_id, subcategoryId: p.subcategory_id }
    withProjection.add(p.category_id)
    if (seen.has(unitKey(unit))) continue
    seen.add(unitKey(unit))
    units.push(unit)
  }

  for (const c of ctx.categories) {
    if (c.parentId !== null) continue
    if (withProjection.has(c.id)) continue
    const unit = { categoryId: c.id, subcategoryId: null }
    if (seen.has(unitKey(unit))) continue
    seen.add(unitKey(unit))
    units.push(unit)
  }

  return units
}

// Alertas de gasto excessivo do período. Função pura: não acessa banco, para
// os três cenários de comparação poderem ser testados isoladamente.
//
// Prioridade por nível avaliado:
//   1. projeção definida no período  -> compara com ela
//   2. sem projeção, >= 2 meses de histórico -> compara com a média
//   3. sem projeção e sem histórico  -> silêncio (não há base de comparação)
//
// Categoria essencial nunca gera alerta, por mais que estoure: a feature é
// especificamente sobre gasto supérfluo.
export function calculateSuggestions(ctx: SuggestionContext): Suggestion[] {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]))
  const projectionByUnit = new Map(
    ctx.projections.map((p) => [unitKey({ categoryId: p.category_id, subcategoryId: p.subcategory_id }), p])
  )
  const dismissed = new Set(
    ctx.dismissals
      .filter((d) => d.period_month.startsWith(ctx.periodMonth))
      .map((d) => unitKey({ categoryId: d.category_id, subcategoryId: d.subcategory_id }))
  )

  const suggestions: Suggestion[] = []

  for (const unit of evaluationUnits(ctx)) {
    if (dismissed.has(unitKey(unit))) continue

    // O nó avaliado é a subcategoria quando o alerta é nesse nível.
    const node = byId.get(unit.subcategoryId ?? unit.categoryId)
    // Categoria fora da árvore da conta: sem nome, sem essencialidade, sem
    // como julgar. Silêncio.
    if (!node) continue
    // Receita não tem "gasto excessivo".
    if (node.direction !== 'out') continue
    if (node.isEssential) continue

    const realized = realizedFor(ctx.entries, unit)
    if (realized <= 0) continue

    const projection = projectionByUnit.get(unitKey(unit))
    const reference = projection ? projection.projected_amount : historyAverage(ctx.historicalEntries, unit)
    // Cenário 3: sem projeção e sem histórico suficiente. Silêncio é melhor
    // que um alerta sem fundamento.
    if (reference == null) continue

    const tolerancePct = projection ? ctx.tolerance.projectionPct : ctx.tolerance.historyPct
    const threshold = reference * (1 + tolerancePct / 100)
    if (realized <= threshold) continue

    const root = unit.subcategoryId ? byId.get(unit.categoryId) : node
    const overAmount = realized - reference

    suggestions.push({
      categoryId: unit.categoryId,
      subcategoryId: unit.subcategoryId,
      categoryName: node.name,
      categoryPath: unit.subcategoryId && root ? `${root.name} > ${node.name}` : node.name,
      realizedAmount: realized,
      referenceAmount: reference,
      referenceType: projection ? 'projection' : 'history_average',
      overAmount,
      // Projeção zerada com gasto lançado estourou 100% do previsto; sem a
      // guarda, a divisão por zero viraria Infinity na tela.
      overPct: reference > 0 ? (overAmount / reference) * 100 : 100,
    })
  }

  // Maior excesso em reais primeiro: é o que o owner precisa ver antes.
  return suggestions.sort((a, b) => b.overAmount - a.overAmount)
}
