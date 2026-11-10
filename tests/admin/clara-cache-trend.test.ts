import { describe, it, expect } from 'vitest'
import { buildClaraCacheTrend, type ClaraCostRow } from '@/lib/admin/clara-cache-trend'

// O painel compara o custo da Clara antes e depois do cache de prompt. O corte
// é a primeira resposta que leu ou gravou cache — não uma data fixa no código,
// porque o deploy pode acontecer em qualquer dia.

function row(createdAt: string, cost: number, conv: string, cache?: { read: number; write: number }, input = 10_000): ClaraCostRow {
  return {
    created_at: createdAt,
    cost_brl: cost,
    input_tokens: input,
    related_id: conv,
    metadata: cache ? { cache_read_tokens: cache.read, cache_write_tokens: cache.write } : {},
  }
}

describe('buildClaraCacheTrend', () => {
  it('separa antes e depois pela primeira resposta com cache', () => {
    const trend = buildClaraCacheTrend(
      [
        row('2026-11-10T12:00:00Z', 0.2, 'c1'),
        row('2026-11-10T12:05:00Z', 0.2, 'c1'),
        row('2026-11-11T12:00:00Z', 0.2, 'c2'),
        row('2026-11-12T12:00:00Z', 0.12, 'c3', { read: 0, write: 8000 }),
        row('2026-11-12T12:03:00Z', 0.04, 'c3', { read: 8000, write: 0 }),
        row('2026-11-13T12:00:00Z', 0.04, 'c4', { read: 8000, write: 0 }),
      ])

    expect(trend.cacheStartedAt).toBe('2026-11-12T12:00:00Z')
    expect(trend.before).toMatchObject({ responses: 3, conversations: 2 })
    expect(trend.before!.perResponse).toBeCloseTo(0.2, 8)
    expect(trend.before!.perConversation).toBeCloseTo(0.3, 8)
    expect(trend.after).toMatchObject({ responses: 3, conversations: 2 })
    expect(trend.after!.perResponse).toBeCloseTo(0.2 / 3, 8)
    expect(trend.after!.perConversation).toBeCloseTo(0.1, 8)
    // 16 mil dos 30 mil tokens de entrada depois do corte vieram do cache.
    expect(trend.after!.cachedShare).toBeCloseTo(16_000 / 30_000, 8)
    expect(trend.perResponseChange).toBeCloseTo(((0.2 / 3 - 0.2) / 0.2) * 100, 6)
  })

  it('sem nenhuma resposta com cache, não há "depois" nem variação', () => {
    const trend = buildClaraCacheTrend([row('2026-11-10T12:00:00Z', 0.2, 'c1')])
    expect(trend.cacheStartedAt).toBeNull()
    expect(trend.before?.responses).toBe(1)
    expect(trend.after).toBeNull()
    expect(trend.perResponseChange).toBeNull()
  })

  it('cache desde o começo do período: não há "antes" para comparar', () => {
    const trend = buildClaraCacheTrend([row('2026-11-15T12:00:00Z', 0.04, 'c1', { read: 8000, write: 0 })])
    expect(trend.before).toBeNull()
    expect(trend.after?.responses).toBe(1)
    expect(trend.perResponseChange).toBeNull()
  })

  it('agrupa por dia de São Paulo e marca os dias com cache', () => {
    const trend = buildClaraCacheTrend(
      [
        // 01:30 UTC do dia 11 ainda é dia 10 em São Paulo.
        row('2026-11-11T01:30:00Z', 0.2, 'c1'),
        row('2026-11-10T13:00:00Z', 0.2, 'c2'),
        row('2026-11-12T13:00:00Z', 0.05, 'c3', { read: 8000, write: 0 }),
      ])
    expect(trend.days).toEqual([
      expect.objectContaining({ date: '2026-11-10', responses: 2, conversations: 2, withCache: false }),
      expect.objectContaining({ date: '2026-11-12', responses: 1, conversations: 1, withCache: true }),
    ])
    expect(trend.days[0].perResponse).toBeCloseTo(0.2, 8)
  })

  it('aceita custo vindo como texto do PostgREST e linha sem conversa', () => {
    const trend = buildClaraCacheTrend(
      [{ created_at: '2026-11-10T12:00:00Z', cost_brl: '0.2' as unknown as number, input_tokens: null, related_id: null, metadata: {} }])
    expect(trend.before).toMatchObject({ responses: 1, conversations: 0 })
    expect(trend.before!.cost).toBeCloseTo(0.2, 8)
    expect(trend.before!.perConversation).toBeNull()
  })
})
