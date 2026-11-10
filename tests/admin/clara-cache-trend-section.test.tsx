import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClaraCacheTrendSection } from '@/components/admin/ClaraCacheTrendSection'
import { buildClaraCacheTrend, type ClaraCostRow } from '@/lib/admin/clara-cache-trend'

function row(createdAt: string, cost: number, conv: string, cached = false): ClaraCostRow {
  return {
    created_at: createdAt,
    cost_brl: cost,
    input_tokens: 10_000,
    related_id: conv,
    metadata: cached ? { cache_read_tokens: 8000, cache_write_tokens: 0 } : {},
  }
}

// formatBRL separa o R$ com espaço não separável; o teste normaliza.
const html = (rows: ClaraCostRow[]) =>
  renderToStaticMarkup(<ClaraCacheTrendSection trend={buildClaraCacheTrend(rows)} />).replace(/ /g, ' ')

describe('ClaraCacheTrendSection', () => {
  it('mostra antes → depois, a variação e uma linha por dia', () => {
    const out = html([
      row('2026-11-09T13:00:00Z', 0.2, 'c1'),
      row('2026-11-11T13:00:00Z', 0.05, 'c2', true),
    ])
    expect(out).toContain('R$ 0,20')
    expect(out).toContain('R$ 0,05')
    expect(out).toContain('-75% com o cache')
    expect(out).toContain('80%') // entrada lida do cache
    expect(out).toContain('09/11')
    expect(out).toContain('11/11')
    expect(out).toContain('Cache ativo desde')
  })

  it('avisa quando nenhuma resposta usou cache, sem riscar o único valor', () => {
    const out = html([row('2026-11-09T13:00:00Z', 0.2, 'c1')])
    expect(out).toContain('Nenhuma resposta usou cache neste período')
    expect(out).not.toContain('line-through')
  })

  it('avisa quando o período começa já com cache', () => {
    expect(html([row('2026-11-11T13:00:00Z', 0.05, 'c1', true)])).toContain('escolha um período maior')
  })

  it('sem respostas no período', () => {
    expect(html([])).toContain('Nenhuma resposta da Clara no período')
  })
})
