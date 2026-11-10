import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchAllPages } from '@/lib/supabase/paginate'
import { MAX_EVENTS } from '@/lib/admin/cost-alerts'

// Efeito do cache de prompt no custo da Clara, para o /admin/costs. Compara as
// respostas antes e depois da primeira que usou cache — o corte sai dos dados,
// não de uma data no código. A parte pura (buildClaraCacheTrend) é testada sem
// Supabase.

const DAY_MS = 24 * 60 * 60 * 1000

export type ClaraCostRow = {
  created_at: string
  cost_brl: number | string
  input_tokens: number | null
  related_id: string | null
  metadata: Record<string, unknown> | null
}

export interface ClaraCostWindow {
  responses: number
  conversations: number
  cost: number
  perResponse: number
  /** null quando nenhuma resposta tem conversa de origem. */
  perConversation: number | null
  /** Fração da entrada lida do cache (0–1). */
  cachedShare: number
}

export interface ClaraCostDay {
  /** YYYY-MM-DD em São Paulo. */
  date: string
  responses: number
  conversations: number
  perResponse: number
  /** Alguma resposta do dia usou cache. */
  withCache: boolean
}

export interface ClaraCacheTrend {
  /** created_at da primeira resposta com cache no período; null se nenhuma. */
  cacheStartedAt: string | null
  before: ClaraCostWindow | null
  after: ClaraCostWindow | null
  /** Variação do custo por resposta, em % (−70 = 70% mais barato). */
  perResponseChange: number | null
  days: ClaraCostDay[]
  truncated: boolean
  error: string | null
}

function toNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

function usedCache(row: ClaraCostRow): boolean {
  const m = row.metadata ?? {}
  return 'cache_read_tokens' in m || 'cache_write_tokens' in m
}

function saoPauloDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function summarize(rows: ClaraCostRow[]): ClaraCostWindow | null {
  if (rows.length === 0) return null
  let cost = 0
  let input = 0
  let cachedRead = 0
  const conversations = new Set<string>()
  for (const r of rows) {
    cost += toNumber(r.cost_brl)
    input += toNumber(r.input_tokens)
    cachedRead += toNumber(r.metadata?.cache_read_tokens)
    if (r.related_id) conversations.add(r.related_id)
  }
  return {
    responses: rows.length,
    conversations: conversations.size,
    cost,
    perResponse: cost / rows.length,
    perConversation: conversations.size > 0 ? cost / conversations.size : null,
    cachedShare: input > 0 ? cachedRead / input : 0,
  }
}

export function buildClaraCacheTrend(
  rows: ClaraCostRow[],
  opts: { truncated?: boolean; error?: string | null } = {},
): ClaraCacheTrend {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const firstCached = sorted.find(usedCache)
  const cacheStartedAt = firstCached?.created_at ?? null

  const beforeRows = cacheStartedAt ? sorted.filter((r) => r.created_at < cacheStartedAt) : sorted
  const afterRows = cacheStartedAt ? sorted.filter((r) => r.created_at >= cacheStartedAt) : []
  const before = summarize(beforeRows)
  const after = summarize(afterRows)

  const byDay = new Map<string, ClaraCostRow[]>()
  for (const r of sorted) {
    const d = saoPauloDate(r.created_at)
    byDay.set(d, [...(byDay.get(d) ?? []), r])
  }
  const days: ClaraCostDay[] = [...byDay.entries()].map(([date, dayRows]) => {
    const s = summarize(dayRows)!
    return { date, responses: s.responses, conversations: s.conversations, perResponse: s.perResponse, withCache: dayRows.some(usedCache) }
  })

  return {
    cacheStartedAt,
    before,
    after,
    perResponseChange:
      before && after && before.perResponse > 0 ? ((after.perResponse - before.perResponse) / before.perResponse) * 100 : null,
    days,
    truncated: opts.truncated ?? false,
    error: opts.error ?? null,
  }
}

export async function getClaraCacheTrend(
  supabase: SupabaseClient<Database>,
  days: number,
  now: Date = new Date(),
): Promise<ClaraCacheTrend> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  // Só a Clara em produção: o simulador do /admin gasta tokens de teste e
  // distorceria o custo por resposta.
  const result = await fetchAllPages<ClaraCostRow>(
    (from, to) =>
      supabase
        .from('cost_events')
        .select('created_at, cost_brl, input_tokens, related_id, metadata')
        .eq('provider', 'claude_agendamento')
        .gte('created_at', since)
        .order('created_at')
        .order('id')
        .range(from, to),
    { max: MAX_EVENTS },
  )
  return buildClaraCacheTrend(result.rows, { truncated: result.truncated, error: result.error })
}
