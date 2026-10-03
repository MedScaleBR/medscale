import { describe, it, expect } from 'vitest'
import { createSupabaseMock, type RecordedCall } from '../helpers/supabase-mock'
import {
  buildCostOverview,
  costAlertRef,
  getCostOverview,
  MAX_EVENTS,
  normalizeCostDays,
  percentChange,
  saoPauloMonth,
  sumCostTotals,
} from '@/lib/admin/cost-alerts'
import { groupByProviderGroup, LOOP_TURN_THRESHOLD, type CostEventRow } from '@/lib/costs/aggregate'

const NOW = new Date('2026-10-02T13:00:00Z')

function event(over: Partial<CostEventRow> = {}): CostEventRow {
  return {
    provider: 'claude_agendamento',
    cost_brl: 1,
    account_id: 'acc1',
    workspace_id: 'w1',
    related_id: 'conv1',
    accounts: { name: 'Clínica A' },
    workspaces: { name: 'Unidade Moema' },
    ...over,
  }
}

describe('ref do alerta', () => {
  // 1º de novembro 01:00 UTC ainda é 31 de outubro em São Paulo.
  it('mês no fuso de São Paulo', () => {
    expect(saoPauloMonth(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10')
    expect(saoPauloMonth(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11')
  })

  it('formato kind:account:YYYY-MM', () => {
    expect(costAlertRef({ kind: 'custo_por_conversa', accountId: 'acc9' }, NOW)).toBe(
      'custo_por_conversa:acc9:2026-10',
    )
  })
})

describe('grupos de provedor', () => {
  it('Claude soma agendamento, financeiro e SOAP', () => {
    expect(
      groupByProviderGroup({
        claude_agendamento: 1,
        claude_financeiro: 2,
        claude_soap: 3,
        whisper: 4,
        whatsapp_conversation: 5,
      }),
    ).toEqual({ claude: 6, whisper: 4, whatsapp: 5 })
  })

  it('sumCostTotals trata numeric em string', () => {
    expect(
      sumCostTotals([
        { provider: 'claude_soap', cost_brl: '1.5000' },
        { provider: 'whatsapp_conversation', cost_brl: 2 },
      ]),
    ).toEqual({ total: 3.5, byGroup: { claude: 1.5, whisper: 0, whatsapp: 2 } })
  })
})

describe('buildCostOverview', () => {
  it('quebra cada cliente por grupo e calcula a fatia do total', () => {
    const overview = buildCostOverview({
      events: [
        event({ provider: 'claude_agendamento', cost_brl: 6 }),
        event({ provider: 'whisper', cost_brl: 2 }),
        event({ provider: 'whatsapp_conversation', cost_brl: 2, account_id: 'acc2', accounts: { name: 'B' } }),
      ],
      previousEvents: null,
      days: 30,
      now: NOW,
    })

    expect(overview.summary.total).toBe(10)
    expect(overview.byGroup).toEqual({ claude: 6, whisper: 2, whatsapp: 2 })
    expect(overview.accounts.map((a) => [a.accountId, a.byGroup, a.share])).toEqual([
      ['acc1', { claude: 6, whisper: 2, whatsapp: 0 }, 0.8],
      ['acc2', { claude: 0, whisper: 0, whatsapp: 2 }, 0.2],
    ])
    expect(overview.previous).toBeNull()
    expect(overview.since).toBe('2026-09-02T13:00:00.000Z')
  })

  it('alertas ganham ref e título', () => {
    const loop = Array.from({ length: LOOP_TURN_THRESHOLD }, () => event({ related_id: 'loop' }))
    const overview = buildCostOverview({ events: loop, previousEvents: [], days: 30, now: NOW })

    expect(overview.alerts).toHaveLength(1)
    expect(overview.alerts[0]).toMatchObject({
      kind: 'conversation_loop',
      ref: 'conversation_loop:acc1:2026-10',
      title: 'Conversas girando sem fechar',
    })
  })

  it('totais do período anterior quando informados', () => {
    const overview = buildCostOverview({
      events: [],
      previousEvents: [{ provider: 'whisper', cost_brl: 4 }],
      days: 7,
      now: NOW,
    })
    expect(overview.previous).toEqual({ total: 4, byGroup: { claude: 0, whisper: 4, whatsapp: 0 } })
  })
})

describe('percentChange', () => {
  it('variação em pontos percentuais', () => {
    expect(percentChange(108, 100)).toBeCloseTo(8)
    expect(percentChange(50, 100)).toBeCloseTo(-50)
  })

  it('sem base para comparar, null', () => {
    expect(percentChange(10, 0)).toBeNull()
    expect(percentChange(10, null)).toBeNull()
  })
})

describe('normalizeCostDays', () => {
  it('aceita só 7/30/90, senão 30', () => {
    expect(normalizeCostDays('7')).toBe(7)
    expect(normalizeCostDays(90)).toBe(90)
    expect(normalizeCostDays('15')).toBe(30)
    expect(normalizeCostDays(undefined)).toBe(30)
  })
})

// Resposta paginada como a do PostgREST: devolve o intervalo pedido por .range().
function paged<T>(rows: T[]) {
  return (call: RecordedCall) => {
    const range = call.filters.find((f) => f[0] === 'range') as [string, number, number] | undefined
    const [from, to] = range ? [range[1], range[2]] : [0, rows.length - 1]
    return { data: rows.slice(from, to + 1), error: null }
  }
}

describe('getCostOverview — paginação', () => {
  it('soma todos os eventos além de 1000 linhas, sem truncar', async () => {
    const events = Array.from({ length: 2500 }, (_, i) => event({ related_id: `conv${i}` }))
    const s = createSupabaseMock({
      cost_events: { select: (call) => (call.filters.some((f) => f[0] === 'lt') ? { data: [] } : paged(events)(call)) },
    })
    const overview = await getCostOverview(s.client as never, 30, NOW)
    expect(overview.summary.total).toBe(2500)
    expect(overview.truncated).toBe(false)
    expect(overview.error).toBeNull()
    const current = s.callsTo('cost_events', 'select').filter((c) => !c.filters.some((f) => f[0] === 'lt'))
    expect(current.map((c) => c.filters.find((f) => f[0] === 'range'))).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
      ['range', 2000, 2999],
    ])
    // Ordem estável entre blocos.
    expect(current[0].filters).toContainEqual(['order', 'created_at'])
    expect(current[0].filters).toContainEqual(['order', 'id'])
  })

  it('bater em MAX_EVENTS marca truncated e esconde a variação', async () => {
    const events = Array.from({ length: MAX_EVENTS + 10 }, () => event())
    const s = createSupabaseMock({ cost_events: { select: paged(events) } })
    const overview = await getCostOverview(s.client as never, 30, NOW)
    expect(overview.summary.total).toBe(MAX_EVENTS)
    expect(overview.truncated).toBe(true)
    expect(overview.previous).toBeNull()
  })

  it('erro na consulta vira error', async () => {
    const s = createSupabaseMock({ cost_events: { select: { data: null, error: { message: 'boom' } } } })
    const overview = await getCostOverview(s.client as never, 30, NOW)
    expect(overview.error).toBe('boom')
    expect(overview.previous).toBeNull()
  })
})
