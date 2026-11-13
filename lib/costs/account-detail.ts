import type { CostProvider } from '@/types/database'
import { NO_UNIT_LABEL, PROVIDER_GROUP, whisperSourceOf, type ProviderGroup } from '@/lib/costs/aggregate'
import { isSingleDay, windowDayCount, type CostWindow } from '@/lib/admin/cost-range'

// Detalhe de custo de UM cliente na aba "Por cliente" de /admin/costs.
// Tudo sai de cost_events (uma linha por chamada cobrada) — nunca de
// `messages`: lá role='assistant' mistura a Clara com a secretária pelo
// celular e com templates automáticos, e o número de "respostas" sairia
// inflado. Puro, para ser testado sem Supabase.

export type CostFeature = 'clara' | 'clara_audio' | 'consulta' | 'soap' | 'simulador' | 'financeiro' | 'whatsapp'

export const COST_FEATURE_LABELS: Record<CostFeature, string> = {
  clara: 'Clara (agendamento)',
  clara_audio: 'Clara — áudio',
  consulta: 'Transcrição de consulta',
  soap: 'Prontuário (SOAP)',
  simulador: 'Simulador da Clara',
  financeiro: 'Agente financeiro',
  whatsapp: 'WhatsApp (Meta)',
}

/** Ordem de desempate quando duas funcionalidades custam o mesmo. */
const FEATURE_ORDER = Object.keys(COST_FEATURE_LABELS) as CostFeature[]

export const COST_FEATURE_GROUP: Record<CostFeature, ProviderGroup> = {
  clara: 'claude',
  clara_audio: 'whisper',
  consulta: 'whisper',
  soap: 'claude',
  simulador: 'claude',
  financeiro: 'claude',
  whatsapp: 'whatsapp',
}

// Custo que depende de o paciente conversar — o mesmo critério do alerta de
// conversa cara. Prontuário e transcrição ficam fora: uma clínica que grava
// muita consulta pareceria cara por conversa.
const CONVERSATION_FEATURES: CostFeature[] = ['clara', 'clara_audio', 'whatsapp']

export interface AccountCostRow {
  provider: CostProvider
  cost_brl: number | string
  workspace_id: string | null
  related_id: string | null
  quantity: number | string | null
  created_at: string
  workspaces?: { name: string } | null
}

export interface FeatureUsage {
  feature: CostFeature
  cost: number
  /** Fração do total do escopo (cliente ou unidade). */
  share: number
  /** Linhas de custo: respostas, áudios, consultas, prontuários, janelas. */
  events: number
  /** related_id distintos — só Clara e WhatsApp; 0 nos demais. */
  conversations: number
  /** Σ quantity ÷ 60 — só os dois usos do Whisper; 0 nos demais. */
  minutes: number
}

export interface SeriesPoint {
  key: string
  label: string
  claude: number
  whisper: number
  whatsapp: number
  total: number
}

export interface UnitDetail {
  workspaceId: string | null
  name: string
  total: number
  features: FeatureUsage[]
}

export interface AccountCostDetail {
  total: number
  perDay: number | null
  perConversation: number | null
  perClaraResponse: number | null
  claraResponses: number
  conversations: number
  features: FeatureUsage[]
  series: {
    mode: 'day' | 'hour'
    points: SeriesPoint[]
    /** Custo do dia parcial antes da 1ª barra (atalhos 7/30/90 são N×24h, não N dias de calendário). */
    outside: number
    /** Dia da 1ª barra — o texto do gráfico diz "antes de" esse dia. */
    outsideBefore: string | null
  }
  units: UnitDetail[]
}

const TZ = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000

function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function featureOf(row: Pick<AccountCostRow, 'provider' | 'related_id'>): CostFeature {
  switch (row.provider) {
    case 'claude_agendamento':
      return 'clara'
    case 'whisper':
      return whisperSourceOf(row) === 'clara' ? 'clara_audio' : 'consulta'
    case 'claude_soap':
      return 'soap'
    case 'claude_simulador':
      return 'simulador'
    case 'claude_financeiro':
      return 'financeiro'
    case 'whatsapp_conversation':
      return 'whatsapp'
  }
}

interface FeatureAcc {
  cost: number
  events: number
  seconds: number
  related: Set<string>
}

function summarizeFeatures(rows: AccountCostRow[]): { total: number; features: FeatureUsage[] } {
  const acc = new Map<CostFeature, FeatureAcc>()
  let total = 0
  for (const row of rows) {
    const feature = featureOf(row)
    const cost = toNumber(row.cost_brl)
    total += cost
    let a = acc.get(feature)
    if (!a) {
      a = { cost: 0, events: 0, seconds: 0, related: new Set() }
      acc.set(feature, a)
    }
    a.cost += cost
    a.events += 1
    if (feature === 'clara_audio' || feature === 'consulta') a.seconds += toNumber(row.quantity)
    if ((feature === 'clara' || feature === 'whatsapp') && row.related_id) a.related.add(row.related_id)
  }

  const features = FEATURE_ORDER.filter((f) => (acc.get(f)?.cost ?? 0) > 0)
    .map((f): FeatureUsage => {
      const a = acc.get(f)!
      return {
        feature: f,
        cost: a.cost,
        share: total > 0 ? a.cost / total : 0,
        events: a.events,
        conversations: a.related.size,
        minutes: a.seconds / 60,
      }
    })
    // sort é estável: empate mantém FEATURE_ORDER.
    .sort((x, y) => y.cost - x.cost)

  return { total, features }
}

function spDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function spHour(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })
}

function emptyPoint(key: string, label: string): SeriesPoint {
  return { key, label, claude: 0, whisper: 0, whatsapp: 0, total: 0 }
}

function buildSeries(rows: AccountCostRow[], window: CostWindow, now: Date): AccountCostDetail['series'] {
  const hourly = isSingleDay(window)
  const points: SeriesPoint[] = []

  if (hourly) {
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0')
      points.push(emptyPoint(key, `${key}h`))
    }
  } else {
    // Atalho de N dias: N barras terminando hoje. A janela é N×24h, então começa
    // no meio do dia anterior à 1ª barra — esse pedaço vai para `outside`.
    const first =
      window.kind === 'custom'
        ? window.from
        : new Date(Date.parse(`${spDate(now)}T00:00:00Z`) - (window.days - 1) * DAY_MS).toISOString().slice(0, 10)
    const last = window.kind === 'custom' ? window.to : spDate(now)
    for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10)
      points.push(emptyPoint(key, `${key.slice(8, 10)}/${key.slice(5, 7)}`))
    }
  }

  const byKey = new Map(points.map((p) => [p.key, p]))
  let outside = 0
  for (const row of rows) {
    const cost = toNumber(row.cost_brl)
    const point = byKey.get(hourly ? spHour(row.created_at) : spDate(row.created_at))
    if (!point) {
      outside += cost
      continue
    }
    point[PROVIDER_GROUP[row.provider]] += cost
    point.total += cost
  }

  return {
    mode: hourly ? 'hour' : 'day',
    points,
    outside,
    outsideBefore: hourly ? null : (points[0]?.key ?? null),
  }
}

function buildUnits(rows: AccountCostRow[]): UnitDetail[] {
  const groups = new Map<string, { workspaceId: string | null; name: string; rows: AccountCostRow[] }>()
  for (const row of rows) {
    const key = row.workspace_id ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      g = { workspaceId: row.workspace_id, name: row.workspaces?.name ?? NO_UNIT_LABEL, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(row)
  }

  return [...groups.values()]
    .map((g) => {
      const { total, features } = summarizeFeatures(g.rows)
      return { workspaceId: g.workspaceId, name: g.name, total, features }
    })
    .sort((a, b) => {
      // "Sem unidade" sempre por último: é a Clara antes de o paciente dizer a
      // unidade, não uma unidade que compete com as outras.
      if ((a.workspaceId === null) !== (b.workspaceId === null)) return a.workspaceId === null ? 1 : -1
      return b.total - a.total
    })
}

export function buildAccountCostDetail(
  rows: AccountCostRow[],
  window: CostWindow,
  now: Date = new Date(),
): AccountCostDetail {
  const { total, features } = summarizeFeatures(rows)

  const claraResponses = rows.filter((r) => r.provider === 'claude_agendamento').length
  const claraCost = features.find((f) => f.feature === 'clara')?.cost ?? 0
  const conversationCost = features
    .filter((f) => CONVERSATION_FEATURES.includes(f.feature))
    .reduce((sum, f) => sum + f.cost, 0)
  const conversationIds = new Set(
    rows
      .filter((r) => (r.provider === 'claude_agendamento' || r.provider === 'whatsapp_conversation') && r.related_id)
      .map((r) => r.related_id!),
  )
  const days = windowDayCount(window)

  return {
    total,
    perDay: days > 0 ? total / days : null,
    perConversation: conversationIds.size > 0 ? conversationCost / conversationIds.size : null,
    perClaraResponse: claraResponses > 0 ? claraCost / claraResponses : null,
    claraResponses,
    conversations: conversationIds.size,
    features,
    series: buildSeries(rows, window, now),
    units: buildUnits(rows),
  }
}
