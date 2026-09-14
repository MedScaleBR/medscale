import { describe, it, expect } from 'vitest'
import {
  summarizeCosts,
  detectLoopAlerts,
  detectExpensiveAccountAlerts,
  LOOP_TURN_THRESHOLD,
  MIN_CONVERSATIONS_FOR_ALERT,
  NO_UNIT_LABEL,
  type CostEventRow,
} from '@/lib/costs/aggregate'

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

describe('summarizeCosts', () => {
  it('soma total, por provider e por cliente', () => {
    const summary = summarizeCosts([
      event({ provider: 'claude_agendamento', cost_brl: 2 }),
      event({ provider: 'whisper', cost_brl: 3 }),
      event({ provider: 'whisper', cost_brl: 7, account_id: 'acc2', accounts: { name: 'Clínica B' } }),
    ])

    expect(summary.total).toBe(12)
    expect(summary.byProvider.whisper).toBe(10)
    expect(summary.byProvider.claude_agendamento).toBe(2)
    expect(summary.byProvider.claude_soap).toBe(0)
    expect(summary.accounts.map((a) => [a.name, a.total])).toEqual([
      ['Clínica B', 7],
      ['Clínica A', 5],
    ])
  })

  it('ordena clientes do mais caro para o mais barato', () => {
    const summary = summarizeCosts([
      event({ cost_brl: 1, account_id: 'a', accounts: { name: 'Barato' } }),
      event({ cost_brl: 90, account_id: 'b', accounts: { name: 'Caro' } }),
      event({ cost_brl: 10, account_id: 'c', accounts: { name: 'Médio' } }),
    ])

    expect(summary.accounts.map((a) => a.name)).toEqual(['Caro', 'Médio', 'Barato'])
  })

  // numeric(12,4) volta como string no supabase-js — somar string concatena.
  it('trata numeric que chega como string', () => {
    const summary = summarizeCosts([event({ cost_brl: '2.5000' }), event({ cost_brl: '0.5000' })])
    expect(summary.total).toBe(3)
  })

  // A Clara é configurada por account e conversations.workspace_id fica NULL
  // até o paciente dizer a unidade. Esse custo é real e precisa aparecer.
  it('custo sem unidade vai para um balde explícito, não some', () => {
    const summary = summarizeCosts([
      event({ cost_brl: 4, workspace_id: null, workspaces: null }),
      event({ cost_brl: 6, workspace_id: 'w1' }),
    ])

    const units = summary.accounts[0].units
    expect(summary.accounts[0].total).toBe(10)
    expect(units.find((u) => u.workspaceId === null)).toMatchObject({ name: NO_UNIT_LABEL, total: 4 })
    expect(units.find((u) => u.workspaceId === 'w1')).toMatchObject({ name: 'Unidade Moema', total: 6 })
  })

  it('account apagada não derruba a agregação', () => {
    const summary = summarizeCosts([event({ accounts: null })])
    expect(summary.accounts[0].name).toBe('Cliente removido')
  })

  it('sem eventos, tudo zera sem quebrar', () => {
    const summary = summarizeCosts([])
    expect(summary.total).toBe(0)
    expect(summary.accounts).toEqual([])
    expect(summary.byProvider.whisper).toBe(0)
  })
})

describe('detectLoopAlerts', () => {
  function loopEvents(conversationId: string, turns: number, over: Partial<CostEventRow> = {}) {
    return Array.from({ length: turns }, () => event({ related_id: conversationId, cost_brl: 0.1, ...over }))
  }

  it('não acusa conversa normal', () => {
    expect(detectLoopAlerts(loopEvents('conv1', 5))).toEqual([])
  })

  it('acusa conversa que passa do limite de respostas', () => {
    const alerts = detectLoopAlerts(loopEvents('conv1', LOOP_TURN_THRESHOLD))

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'conversation_loop', accountId: 'acc1', accountName: 'Clínica A' })
    expect(alerts[0].cost).toBeCloseTo(LOOP_TURN_THRESHOLD * 0.1, 8)
  })

  // Cinco conversas em loop no mesmo cliente é UM bot mal configurado, não
  // cinco incidentes — senão o painel vira uma lista de ruído.
  it('agrupa várias conversas em loop num alerta por cliente', () => {
    const alerts = detectLoopAlerts([
      ...loopEvents('conv1', LOOP_TURN_THRESHOLD),
      ...loopEvents('conv2', LOOP_TURN_THRESHOLD),
    ])

    expect(alerts).toHaveLength(1)
    expect(alerts[0].detail).toContain('2 conversas')
  })

  it('conta turnos por conversa, não por cliente', () => {
    // Duas conversas curtas do mesmo cliente somam o limite, mas nenhuma está
    // em loop — isso não pode virar alerta.
    const alerts = detectLoopAlerts([
      ...loopEvents('conv1', LOOP_TURN_THRESHOLD - 1),
      ...loopEvents('conv2', LOOP_TURN_THRESHOLD - 1),
    ])

    expect(alerts).toEqual([])
  })

  it('ignora providers que não são a Clara', () => {
    const alerts = detectLoopAlerts(loopEvents('conv1', LOOP_TURN_THRESHOLD, { provider: 'claude_soap' }))
    expect(alerts).toEqual([])
  })

  it('ignora eventos sem conversa de origem', () => {
    const alerts = detectLoopAlerts(loopEvents('conv1', LOOP_TURN_THRESHOLD).map((e) => ({ ...e, related_id: null })))
    expect(alerts).toEqual([])
  })

  it('ordena pelo que custou mais caro', () => {
    const alerts = detectLoopAlerts([
      ...loopEvents('conv1', LOOP_TURN_THRESHOLD, { account_id: 'barato', accounts: { name: 'Barato' } }),
      ...loopEvents('conv2', LOOP_TURN_THRESHOLD, {
        account_id: 'caro',
        accounts: { name: 'Caro' },
        cost_brl: 5,
      }),
    ])

    expect(alerts.map((a) => a.accountName)).toEqual(['Caro', 'Barato'])
  })
})

describe('detectExpensiveAccountAlerts', () => {
  /** n conversas distintas, cada uma com uma resposta da Clara e a janela do WhatsApp. */
  function conversations(n: number, claudeCost: number, over: Partial<CostEventRow> = {}) {
    return Array.from({ length: n }, (_, i) => [
      event({ provider: 'claude_agendamento', cost_brl: claudeCost, related_id: `conv${i}`, ...over }),
      event({ provider: 'whatsapp_conversation', cost_brl: 0.55, related_id: `conv${i}`, ...over }),
    ]).flat()
  }

  it('conversa barata e normal não vira alerta', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      event({ cost_brl: 0.02, related_id: `conv${i}` })
    )
    expect(detectExpensiveAccountAlerts(rows)).toEqual([])
  })

  it('acusa o cliente cuja conversa média destoa', () => {
    const alerts = detectExpensiveAccountAlerts(conversations(6, 0.25))

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'custo_por_conversa', accountId: 'acc1', accountName: 'Clínica A' })
    // 6 conversas a R$0,80 (0,25 da Clara + 0,55 da janela).
    expect(alerts[0].detail).toContain('6 conversas')
    expect(alerts[0].cost).toBeCloseTo(4.8, 8)
  })

  // Sem piso de volume, uma conta com duas conversas no período viraria alerta
  // toda semana morta e o painel perderia a credibilidade.
  it('não acusa conta com movimento pequeno demais para ter média', () => {
    const alerts = detectExpensiveAccountAlerts(conversations(MIN_CONVERSATIONS_FOR_ALERT - 1, 5))
    expect(alerts).toEqual([])
  })

  // A mesma conversa gera uma linha por resposta da Clara — contar linhas faria
  // toda conta movimentada parecer em loop.
  it('conta conversas distintas, não linhas de custo', () => {
    const rows = [
      ...Array.from({ length: 30 }, () => event({ cost_brl: 0.1, related_id: 'conv1' })),
      ...Array.from({ length: 5 }, (_, i) => event({ cost_brl: 0.1, related_id: `outra${i}` })),
    ]

    const alerts = detectExpensiveAccountAlerts(rows)
    expect(alerts[0].detail).toContain('6 conversas')
  })

  // Uma clínica que grava muita consulta não é um bot em loop.
  it('prontuário e Whisper não entram no custo por conversa', () => {
    const rows = [
      ...conversations(6, 0.01),
      event({ provider: 'claude_soap', cost_brl: 99, related_id: 'tr1' }),
      event({ provider: 'whisper', cost_brl: 99, related_id: 'tr1' }),
    ]

    // 6 conversas a R$0,56 ficariam acima do limite só por causa da janela,
    // então o que se verifica aqui é que o SOAP não inflou nada além disso.
    const alerts = detectExpensiveAccountAlerts(rows)
    expect(alerts[0].cost).toBeCloseTo(6 * 0.56, 8)
  })

  it('ordena pelo que custou mais caro', () => {
    const alerts = detectExpensiveAccountAlerts([
      ...conversations(6, 0.25, { account_id: 'barato', accounts: { name: 'Barato' } }),
      ...conversations(6, 2, { account_id: 'caro', accounts: { name: 'Caro' } }),
    ])

    expect(alerts.map((a) => a.accountName)).toEqual(['Caro', 'Barato'])
  })
})
