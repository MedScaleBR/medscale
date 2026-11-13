import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// O gráfico (recharts) não tem layout no SSR do teste; a view é o que importa.
vi.mock('@/components/admin/costs/CostSeriesChart', () => ({ CostSeriesChart: () => null }))

import { AccountCostDetailView, featureUsageText } from '@/components/admin/costs/AccountCostDetail'
import { AccountStrip } from '@/components/admin/costs/AccountStrip'
import { buildAccountCostDetail, type AccountCostRow, type FeatureUsage } from '@/lib/costs/account-detail'
import { windowFromDays } from '@/lib/admin/cost-range'

const now = new Date('2026-11-12T15:00:00Z')
const norm = (s: string) => s.replace(/ /g, ' ')

function row(over: Partial<AccountCostRow> = {}): AccountCostRow {
  return {
    provider: 'claude_agendamento',
    cost_brl: 1,
    workspace_id: 'w1',
    related_id: 'c1',
    quantity: null,
    created_at: '2026-11-10T15:00:00Z',
    workspaces: { name: 'Unidade Lauro' },
    ...over,
  }
}

const usage = (over: Partial<FeatureUsage>): FeatureUsage => ({
  feature: 'clara',
  cost: 1,
  share: 1,
  events: 0,
  conversations: 0,
  minutes: 0,
  ...over,
})

describe('featureUsageText', () => {
  it('descreve o uso de cada funcionalidade', () => {
    expect(featureUsageText(usage({ feature: 'clara', conversations: 3, events: 4 }))).toBe('3 conversas · 4 respostas')
    expect(featureUsageText(usage({ feature: 'consulta', events: 2, minutes: 22.7 }))).toBe('2 consultas · 22,7 min')
    expect(featureUsageText(usage({ feature: 'clara_audio', events: 1, minutes: 0.5 }))).toBe('1 áudio · 0,5 min')
    expect(featureUsageText(usage({ feature: 'soap', events: 1 }))).toBe('1 prontuário')
    expect(featureUsageText(usage({ feature: 'simulador', events: 12 }))).toBe('12 respostas')
    expect(featureUsageText(usage({ feature: 'financeiro', events: 2 }))).toBe('2 chamadas')
    expect(featureUsageText(usage({ feature: 'whatsapp', events: 1 }))).toBe('1 janela de 24h')
    expect(featureUsageText(usage({ feature: 'whatsapp', events: 2 }))).toBe('2 janelas de 24h')
  })
})

describe('AccountCostDetailView', () => {
  const rows = [
    row({ related_id: 'c1' }),
    row({ related_id: 'c2' }),
    row({ provider: 'claude_soap', related_id: 't1', cost_brl: 5 }),
    row({ workspace_id: null, workspaces: null, cost_brl: 2, related_id: 'c3' }),
  ]
  const html = (detail = buildAccountCostDetail(rows, windowFromDays(30, now), now)) =>
    norm(renderToStaticMarkup(<AccountCostDetailView name="Dr. Teste" detail={detail} truncated={false} error={null} />))

  it('resumo, funcionalidades e unidades', () => {
    const out = html()
    expect(out).toContain('R$ 9,00')
    expect(out).toContain('Por mensagem da Clara')
    expect(out).toContain('Prontuário (SOAP)')
    expect(out).toContain('Clara (agendamento)')
    expect(out.indexOf('Unidade Lauro')).toBeLessThan(out.indexOf('Sem unidade'))
    expect(out).toContain('Clara antes de o paciente escolher a unidade')
  })

  it('métrica sem base mostra traço', () => {
    const only = buildAccountCostDetail([row({ provider: 'claude_soap', related_id: 't1' })], windowFromDays(30, now), now)
    expect(html(only)).toContain('—')
  })

  it('cliente sem custo no período', () => {
    expect(html(buildAccountCostDetail([], windowFromDays(30, now), now))).toContain(
      'Nenhum custo deste cliente no período',
    )
  })

  it('consulta truncada avisa', () => {
    const detail = buildAccountCostDetail(rows, windowFromDays(30, now), now)
    const out = renderToStaticMarkup(<AccountCostDetailView name="X" detail={detail} truncated error={null} />)
    expect(out).toContain('subestimados')
  })
})

describe('AccountStrip', () => {
  it('marca o cliente selecionado', () => {
    const out = renderToStaticMarkup(
      <AccountStrip
        accounts={[
          { accountId: 'a', name: 'Alfa', total: 10 },
          { accountId: 'b', name: 'Beta', total: 2 },
        ]}
        selectedId="b"
        hrefFor={(id) => `/admin/costs?tab=cliente&account=${id}`}
      />,
    )
    expect(out).toMatch(/aria-current="page"[^>]*href="\/admin\/costs\?tab=cliente&amp;account=b"|href="\/admin\/costs\?tab=cliente&amp;account=b"[^>]*aria-current="page"/)
    expect(out).toContain('Alfa')
  })
})
