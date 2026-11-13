import { describe, it, expect } from 'vitest'
import {
  buildAccountCostDetail,
  featureOf,
  COST_FEATURE_LABELS,
  type AccountCostRow,
} from '@/lib/costs/account-detail'
import { parseCostWindow, windowFromDays } from '@/lib/admin/cost-range'
import { NO_UNIT_LABEL } from '@/lib/costs/aggregate'

const now = new Date('2026-11-12T15:00:00Z')
const range = (from: string, to: string) => parseCostWindow({ from, to }, now)

function row(over: Partial<AccountCostRow> = {}): AccountCostRow {
  return {
    provider: 'claude_agendamento',
    cost_brl: 1,
    workspace_id: 'w1',
    related_id: 'c1',
    quantity: null,
    created_at: '2026-11-04T15:00:00Z',
    workspaces: { name: 'Unidade Lauro' },
    ...over,
  }
}

// O cenário do plano: 4 respostas da Clara em 2 conversas, 1 áudio da Clara,
// 1 janela de WhatsApp numa 3ª conversa e 1 prontuário.
const scenario: AccountCostRow[] = [
  row({ related_id: 'c1' }),
  row({ related_id: 'c1' }),
  row({ related_id: 'c2' }),
  row({ related_id: 'c2' }),
  row({ provider: 'whisper', cost_brl: 0.5, related_id: null, quantity: 30 }),
  row({ provider: 'whatsapp_conversation', cost_brl: 0.5, related_id: 'c3' }),
  row({ provider: 'claude_soap', cost_brl: 5, related_id: 't1' }),
]

describe('featureOf', () => {
  it('separa cada origem de custo', () => {
    expect(featureOf({ provider: 'whisper', related_id: null })).toBe('clara_audio')
    expect(featureOf({ provider: 'whisper', related_id: 't1' })).toBe('consulta')
    expect(featureOf({ provider: 'claude_agendamento', related_id: 'c' })).toBe('clara')
    expect(featureOf({ provider: 'claude_soap', related_id: 't' })).toBe('soap')
    expect(featureOf({ provider: 'claude_simulador', related_id: null })).toBe('simulador')
    expect(featureOf({ provider: 'claude_financeiro', related_id: null })).toBe('financeiro')
    expect(featureOf({ provider: 'whatsapp_conversation', related_id: 'c' })).toBe('whatsapp')
  })

  it('rótulos exatos', () => {
    expect(COST_FEATURE_LABELS).toEqual({
      clara: 'Clara (agendamento)',
      clara_audio: 'Clara — áudio',
      consulta: 'Transcrição de consulta',
      soap: 'Prontuário (SOAP)',
      simulador: 'Simulador da Clara',
      financeiro: 'Agente financeiro',
      whatsapp: 'WhatsApp (Meta)',
    })
  })
})

describe('buildAccountCostDetail — métricas', () => {
  const d = buildAccountCostDetail(scenario, range('2026-11-03', '2026-11-05'), now)

  it('totais, respostas e conversas', () => {
    expect(d.total).toBe(10)
    expect(d.claraResponses).toBe(4)
    expect(d.conversations).toBe(3)
  })

  it('por resposta só o Claude da Clara; por conversa sem prontuário', () => {
    expect(d.perClaraResponse).toBe(1)
    expect(d.perConversation).toBeCloseTo(5 / 3)
  })

  it('média por dia usa os dias do período', () => {
    expect(d.perDay).toBeCloseTo(10 / 3)
  })

  it('funcionalidades com custo, da mais cara para a mais barata', () => {
    expect(d.features.map((f) => f.feature)).toEqual(['soap', 'clara', 'clara_audio', 'whatsapp'])
    const clara = d.features.find((f) => f.feature === 'clara')!
    expect(clara).toMatchObject({ cost: 4, events: 4, conversations: 2 })
    expect(clara.share).toBeCloseTo(4 / 10)
    expect(d.features.find((f) => f.feature === 'clara_audio')!.minutes).toBe(0.5)
  })

  it('sem resposta da Clara nem conversa, métricas nulas', () => {
    const only = buildAccountCostDetail([row({ provider: 'claude_soap', related_id: 't1' })], windowFromDays(7, now), now)
    expect(only.perClaraResponse).toBeNull()
    expect(only.perConversation).toBeNull()
  })

  it('minutos somam quantity em segundos, inclusive string', () => {
    const r = buildAccountCostDetail(
      [
        row({ provider: 'whisper', related_id: 't1', quantity: '90.00' }),
        row({ provider: 'whisper', related_id: 't2', quantity: 30 }),
      ],
      windowFromDays(7, now),
      now,
    )
    expect(r.features[0]).toMatchObject({ feature: 'consulta', minutes: 2, events: 2 })
  })
})

describe('buildAccountCostDetail — série', () => {
  it('por dia em São Paulo, com dias vazios', () => {
    const d = buildAccountCostDetail(
      [
        // 23:30 de 03/11 em São Paulo
        row({ created_at: '2026-11-04T02:30:00Z', cost_brl: 2 }),
        row({ provider: 'claude_soap', created_at: '2026-11-05T12:00:00Z', cost_brl: 1 }),
        row({ provider: 'whisper', related_id: 't1', created_at: '2026-11-05T12:00:00Z', cost_brl: 0.5 }),
      ],
      range('2026-11-03', '2026-11-05'),
      now,
    )
    expect(d.series.mode).toBe('day')
    expect(d.series.points.map((p) => [p.key, p.label, p.total])).toEqual([
      ['2026-11-03', '03/11', 2],
      ['2026-11-04', '04/11', 0],
      ['2026-11-05', '05/11', 1.5],
    ])
    expect(d.series.points[2]).toMatchObject({ claude: 1, whisper: 0.5, whatsapp: 0 })
  })

  it('7 dias mostra 7 barras terminando hoje', () => {
    const d = buildAccountCostDetail([], windowFromDays(7, now), now)
    expect(d.series.points).toHaveLength(7)
    expect(d.series.points[0].key).toBe('2026-11-06')
    expect(d.series.points.at(-1)!.key).toBe('2026-11-12')
    expect(d.series.outside).toBe(0)
  })

  it('custo do dia parcial antes da 1ª barra fica fora do gráfico e é informado', () => {
    // since = 05/11 12:00 BRT; 05/11 15:00 BRT está no período mas antes da 1ª barra (06/11).
    const d = buildAccountCostDetail(
      [row({ created_at: '2026-11-05T18:00:00Z', cost_brl: 2 }), row({ created_at: '2026-11-06T18:00:00Z', cost_brl: 1 })],
      windowFromDays(7, now),
      now,
    )
    expect(d.series.outside).toBe(2)
    expect(d.series.outsideBefore).toBe('2026-11-06')
    expect(d.series.points[0].total).toBe(1)
    expect(d.total).toBe(3)
  })

  it('um dia só vira série por hora', () => {
    const d = buildAccountCostDetail(
      [row({ created_at: '2026-11-11T13:10:00Z', cost_brl: 3 })],
      range('2026-11-11', '2026-11-11'),
      now,
    )
    expect(d.series.mode).toBe('hour')
    expect(d.series.points).toHaveLength(24)
    expect(d.series.points[0]).toMatchObject({ key: '00', label: '00h' })
    expect(d.series.points.find((p) => p.key === '10')!.claude).toBe(3)
  })
})

describe('buildAccountCostDetail — unidades', () => {
  it('cada unidade com as suas funcionalidades; sem unidade por último', () => {
    const d = buildAccountCostDetail(
      [
        row({ workspace_id: null, workspaces: null, cost_brl: 40 }),
        row({ workspace_id: 'w1', cost_brl: 2 }),
        row({ provider: 'claude_soap', workspace_id: 'w1', related_id: 't1', cost_brl: 2 }),
        row({ workspace_id: 'w2', workspaces: { name: 'Unidade Pituba' }, cost_brl: 1 }),
      ],
      windowFromDays(30, now),
      now,
    )
    expect(d.units.map((u) => [u.name, u.total])).toEqual([
      ['Unidade Lauro', 4],
      ['Unidade Pituba', 1],
      [NO_UNIT_LABEL, 40],
    ])
    expect(d.units[0].features.map((f) => [f.feature, f.share])).toEqual([
      ['clara', 0.5],
      ['soap', 0.5],
    ])
  })

  it('sem eventos, tudo zerado', () => {
    const d = buildAccountCostDetail([], range('2026-11-10', '2026-11-11'), now)
    expect(d).toMatchObject({ total: 0, features: [], units: [], perClaraResponse: null, perConversation: null })
    expect(d.series.points.map((p) => p.total)).toEqual([0, 0])
  })
})
