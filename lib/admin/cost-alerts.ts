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

// Visão de custos do /admin: a consulta a cost_events que antes vivia na
// página de custos, mais o que o dashboard e a fila precisam (grupos de
// provedor, período anterior, ref estável de cada alerta). A parte pura fica
// em buildCostOverview para ser testada sem Supabase.

export const COST_PERIODS = [7, 30, 90] as const
export const DEFAULT_COST_DAYS = 30

// Teto de segurança: o painel agrega em memória. Se algum dia bater neste
// número, a agregação precisa virar SQL — não aumentar o limite.
export const MAX_EVENTS = 50_000

const DAY_MS = 24 * 60 * 60 * 1000

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
  days: number
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

export function normalizeCostDays(value: string | number | null | undefined): number {
  const n = Number(value)
  return COST_PERIODS.includes(n as (typeof COST_PERIODS)[number]) ? n : DEFAULT_COST_DAYS
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
  days: number
  now: Date
  truncated?: boolean
  error?: string | null
}): CostOverview {
  const { events, previousEvents, days, now } = input
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
    days,
    since: new Date(now.getTime() - days * DAY_MS).toISOString(),
    summary,
    byGroup,
    accounts,
    alerts,
    previous: previousEvents ? sumCostTotals(previousEvents) : null,
    truncated: input.truncated ?? false,
    error: input.error ?? null,
  }
}

export async function getCostOverview(
  supabase: SupabaseClient<Database>,
  days: number = DEFAULT_COST_DAYS,
  now: Date = new Date(),
): Promise<CostOverview> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  const previousSince = new Date(now.getTime() - 2 * days * DAY_MS).toISOString()

  // Tudo sai de cost_events: os dois sinais de bot mal configurado são
  // deriváveis do próprio custo, sem ler conversa nem telefone de paciente.
  const [currentRes, previousRes] = await Promise.all([
    supabase
      .from('cost_events')
      .select('provider, cost_brl, account_id, workspace_id, related_id, accounts(name), workspaces(name)')
      .gte('created_at', since)
      .limit(MAX_EVENTS),
    supabase
      .from('cost_events')
      .select('provider, cost_brl')
      .gte('created_at', previousSince)
      .lt('created_at', since)
      .limit(MAX_EVENTS),
  ])

  const events = (currentRes.data ?? []) as unknown as CostEventRow[]
  const previousRows = (previousRes.data ?? []) as CostTotalRow[]
  // Período anterior truncado ou com erro daria uma variação falsa — melhor
  // não mostrar nenhuma.
  const previousOk = !previousRes.error && previousRows.length < MAX_EVENTS

  return buildCostOverview({
    events,
    previousEvents: previousOk ? previousRows : null,
    days,
    now,
    truncated: events.length >= MAX_EVENTS,
    error: currentRes.error?.message ?? null,
  })
}

/** Só os totais (dashboard): não traz account/unidade nem roda os alertas. */
export async function getCostTotals(
  supabase: SupabaseClient<Database>,
  days: number = DEFAULT_COST_DAYS,
  now: Date = new Date(),
): Promise<CostPeriodTotals> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  const { data } = await supabase
    .from('cost_events')
    .select('provider, cost_brl')
    .gte('created_at', since)
    .limit(MAX_EVENTS)
  return sumCostTotals((data ?? []) as CostTotalRow[])
}
