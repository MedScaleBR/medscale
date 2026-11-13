import type { SupabaseClient } from '@supabase/supabase-js'
import type { CostProvider, Database } from '@/types/database'
import {
  summarizeCosts,
  detectLoopAlerts,
  detectExpensiveAccountAlerts,
  groupByProviderGroup,
  type AccountCost,
  type CostAlert,
  type CostAlertKind,
  type CostEventRow,
  type CostSummary,
  type ProviderGroup,
} from '@/lib/costs/aggregate'
import { fetchAllPages } from '@/lib/supabase/paginate'
import {
  DEFAULT_COST_DAYS,
  previousWindow,
  windowDayCount,
  windowFromDays,
  type CostWindow,
} from '@/lib/admin/cost-range'

// Visão de custos do /admin: a consulta a cost_events que antes vivia na
// página de custos, mais o que o dashboard e a fila precisam (grupos de
// provedor, período anterior, ref estável de cada alerta). A parte pura fica
// em buildCostOverview para ser testada sem Supabase.

export { COST_PERIODS, DEFAULT_COST_DAYS, normalizeCostDays } from '@/lib/admin/cost-range'

// Teto de segurança: o painel agrega em memória (lendo em blocos de 1000, ver
// fetchAllPages). Se algum dia bater neste número, a agregação precisa virar
// SQL — não aumentar o limite.
export const MAX_EVENTS = 50_000

// Título curto do alerta para listas (fila, Kanban, tarefa criada a partir
// dele). O `detail` continua sendo a frase com os números.
export const COST_ALERT_TITLES: Record<CostAlertKind, string> = {
  conversation_loop: 'Conversas girando sem fechar',
  custo_por_conversa: 'Conversa média cara demais',
}

export interface CostAlertWithRef extends CostAlert {
  /** `${kind}:${accountId}:${YYYY-MM}` — chave de account_tasks.source_ref. */
  ref: string
  title: string
}

export interface CostOverviewAccount extends AccountCost {
  /** Custo do cliente nos 3 grupos de provedor, para a barra empilhada. */
  byGroup: Record<ProviderGroup, number>
  /** Fração do total do período (0–1). */
  share: number
}

export interface CostPeriodTotals {
  total: number
  byGroup: Record<ProviderGroup, number>
}

export interface CostOverview {
  /** Dias do período (N, ou dias do intervalo personalizado). */
  days: number
  window: CostWindow
  /** Início do período, ISO. */
  since: string
  summary: CostSummary
  byGroup: Record<ProviderGroup, number>
  accounts: CostOverviewAccount[]
  alerts: CostAlertWithRef[]
  /** Mesmo intervalo imediatamente antes; null se não deu para medir. */
  previous: CostPeriodTotals | null
  /** A consulta do período bateu em MAX_EVENTS — números subestimados. */
  truncated: boolean
  error: string | null
}

/** Linha mínima para totais: só provedor e custo. */
export type CostTotalRow = Pick<CostEventRow, 'provider' | 'cost_brl'>

function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** YYYY-MM do instante no fuso de São Paulo. */
export function saoPauloMonth(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
}

// O mês entra na chave para o mesmo sintoma voltar a virar tarefa no mês
// seguinte, sem duplicar dentro do mês (índice único em source_type+source_ref).
export function costAlertRef(alert: Pick<CostAlert, 'kind' | 'accountId'>, now: Date): string {
  return `${alert.kind}:${alert.accountId}:${saoPauloMonth(now)}`
}

export function sumCostTotals(rows: CostTotalRow[]): CostPeriodTotals {
  const byProvider = {} as Record<CostProvider, number>
  let total = 0
  for (const row of rows) {
    const cost = toNumber(row.cost_brl)
    total += cost
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + cost
  }
  return { total, byGroup: groupByProviderGroup(byProvider) }
}

/** Variação percentual (8 = +8%). null quando não há base para comparar. */
export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function buildCostOverview(input: {
  events: CostEventRow[]
  previousEvents: CostTotalRow[] | null
  window: CostWindow
  now: Date
  truncated?: boolean
  error?: string | null
}): CostOverview {
  const { events, previousEvents, window, now } = input
  const summary = summarizeCosts(events)
  const byGroup = groupByProviderGroup(summary.byProvider)

  const accounts: CostOverviewAccount[] = summary.accounts.map((a) => ({
    ...a,
    byGroup: groupByProviderGroup(a.byProvider),
    share: summary.total > 0 ? a.total / summary.total : 0,
  }))

  const alerts: CostAlertWithRef[] = [...detectLoopAlerts(events), ...detectExpensiveAccountAlerts(events)].map(
    (a) => ({ ...a, ref: costAlertRef(a, now), title: COST_ALERT_TITLES[a.kind] }),
  )

  return {
    days: windowDayCount(window),
    window,
    since: window.since,
    summary,
    byGroup,
    accounts,
    alerts,
    previous: previousEvents ? sumCostTotals(previousEvents) : null,
    truncated: input.truncated ?? false,
    error: input.error ?? null,
  }
}

function toWindow(period: number | CostWindow, now: Date): CostWindow {
  return typeof period === 'number' ? windowFromDays(period, now) : period
}

export async function getCostOverview(
  supabase: SupabaseClient<Database>,
  period: number | CostWindow = DEFAULT_COST_DAYS,
  now: Date = new Date(),
  /** withPrevious: false pula a consulta do período anterior (a aba Por cliente não mostra variação). */
  options: { withPrevious?: boolean } = {},
): Promise<CostOverview> {
  const window = toWindow(period, now)
  const previous = previousWindow(window, now)
  const withPrevious = options.withPrevious ?? true

  // Tudo sai de cost_events: os dois sinais de bot mal configurado são
  // deriváveis do próprio custo, sem ler conversa nem telefone de paciente.
  // Paginado (o PostgREST corta em 1000 linhas) com ordem estável.
  const [current, prior] = await Promise.all([
    fetchAllPages(
      (from, to) => {
        const q = supabase
          .from('cost_events')
          .select('provider, cost_brl, account_id, workspace_id, related_id, accounts(name), workspaces(name)')
          .gte('created_at', window.since)
        return (window.until ? q.lt('created_at', window.until) : q).order('created_at').order('id').range(from, to)
      },
      { max: MAX_EVENTS },
    ),
    withPrevious
      ? fetchAllPages<CostTotalRow>(
          (from, to) =>
            supabase
              .from('cost_events')
              .select('provider, cost_brl')
              .gte('created_at', previous.since)
              .lt('created_at', previous.until)
              .order('created_at')
              .order('id')
              .range(from, to),
          { max: MAX_EVENTS },
        )
      : null,
  ])

  // Período anterior truncado ou com erro daria uma variação falsa — melhor
  // não mostrar nenhuma.
  const previousOk = prior !== null && !prior.error && !prior.truncated

  return buildCostOverview({
    events: current.rows as unknown as CostEventRow[],
    previousEvents: previousOk && prior ? prior.rows : null,
    window,
    now,
    truncated: current.truncated,
    error: current.error,
  })
}

/** Só os totais (dashboard sem a visão completa): não traz account/unidade nem roda os alertas. */
export async function getCostTotals(
  supabase: SupabaseClient<Database>,
  period: number | CostWindow = DEFAULT_COST_DAYS,
  now: Date = new Date(),
): Promise<CostPeriodTotals> {
  const window = toWindow(period, now)
  const { rows } = await fetchAllPages<CostTotalRow>(
    (from, to) => {
      const q = supabase.from('cost_events').select('provider, cost_brl').gte('created_at', window.since)
      return (window.until ? q.lt('created_at', window.until) : q).order('created_at').order('id').range(from, to)
    },
    { max: MAX_EVENTS },
  )
  return sumCostTotals(rows)
}
