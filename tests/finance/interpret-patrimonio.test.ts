import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const createMock = vi.hoisted(() => vi.fn())
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock } },
}))

import { interpretMessage } from '@/lib/finance/interpret'

const TREE: FinanceCategoryTree = {
  pf: [
    { id: 'pf-mer', name: 'Mercado', direction: 'out', sortOrder: 0, isArchived: false, isEssential: true, children: [] },
  ],
  pj: [],
}

// Mesmo formato do tool `registrar_intencao` de interpret.ts: todos os campos
// são obrigatórios no schema, então o base traz tudo em null.
const BASE_INPUT = {
  intencao: 'desconhecido',
  lancamentos: [],
  tipo: null, categoria: null, subcategoria: null, unidade: null, direcao: null,
  mes: null, paciente: null, horario: null, forma_pagamento: null,
  reserva: null, meta: null, valor: null,
  investimento_nome: null, investimento_tipo: null, taxa_tipo: null, taxa_valor: null,
}

function toolResponse(overrides: Record<string, unknown>) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'registrar_intencao', input: { ...BASE_INPUT, ...overrides } }],
  }
}

beforeEach(() => createMock.mockReset())

describe('interpretMessage — reservas', () => {
  it('guardar_reserva vira reserve_deposit com nome e valor', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'guardar_reserva', reserva: 'emergência', valor: 500, tipo: 'pf' })
    )
    const intent = await interpretMessage('guardei 500 na reserva de emergência', '2026-09-11', TREE)
    expect(intent).toMatchObject({ kind: 'reserve_deposit', reserve: 'emergência', amount: 500, type: 'pf' })
  })

  it('retirar_reserva vira reserve_withdrawal', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'retirar_reserva', reserva: 'viagem', valor: 300, tipo: 'pf' })
    )
    const intent = await interpretMessage('tirei 300 da reserva de viagem', '2026-09-11', TREE)
    expect(intent).toMatchObject({ kind: 'reserve_withdrawal', reserve: 'viagem', amount: 300 })
  })

  it('reserva sem valor mantém amount null (o agente pergunta depois)', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'guardar_reserva', reserva: 'emergência', valor: null })
    )
    const intent = await interpretMessage('guardei um dinheiro na reserva de emergência', '2026-09-11', TREE)
    expect(intent).toMatchObject({ kind: 'reserve_deposit', reserve: 'emergência', amount: null })
  })

  it('valor zero ou negativo não vira amount', async () => {
    createMock.mockResolvedValue(toolResponse({ intencao: 'guardar_reserva', reserva: 'x', valor: 0 }))
    expect(await interpretMessage('guardei na reserva x', '2026-09-11', TREE)).toMatchObject({ amount: null })

    createMock.mockResolvedValue(toolResponse({ intencao: 'guardar_reserva', reserva: 'x', valor: -50 }))
    expect(await interpretMessage('guardei na reserva x', '2026-09-11', TREE)).toMatchObject({ amount: null })
  })

  it('nome de reserva em branco vira null', async () => {
    createMock.mockResolvedValue(toolResponse({ intencao: 'guardar_reserva', reserva: '   ', valor: 100 }))
    expect(await interpretMessage('guardei 100', '2026-09-11', TREE)).toMatchObject({ reserve: null })
  })
})

describe('interpretMessage — investimentos', () => {
  it('investimento com taxa completa preserva rateType e rateValue', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        intencao: 'investimento', investimento_nome: 'CDB Banco X', investimento_tipo: 'renda_fixa',
        valor: 1000, taxa_tipo: 'pct_cdi', taxa_valor: 110, tipo: 'pf',
      })
    )
    const intent = await interpretMessage('investi 1000 no CDB do banco X, 110% do CDI', '2026-09-11', TREE)
    expect(intent).toMatchObject({
      kind: 'investment', name: 'CDB Banco X', investmentType: 'renda_fixa',
      amount: 1000, rateType: 'pct_cdi', rateValue: 110,
    })
  })

  // Nunca inventar rendimento: meia taxa não vira taxa nenhuma.
  it('taxa_tipo sem taxa_valor não vira taxa', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        intencao: 'investimento', investimento_nome: 'CDB', investimento_tipo: 'renda_fixa',
        valor: 1000, taxa_tipo: 'pct_cdi', taxa_valor: null,
      })
    )
    const intent = await interpretMessage('investi 1000 no CDB atrelado ao CDI', '2026-09-11', TREE)
    expect(intent).toMatchObject({ kind: 'investment', rateType: null, rateValue: null })
  })

  it('taxa_valor sem taxa_tipo não vira taxa', async () => {
    createMock.mockResolvedValue(
      toolResponse({
        intencao: 'investimento', investimento_nome: 'CDB', investimento_tipo: 'renda_fixa',
        valor: 1000, taxa_tipo: null, taxa_valor: 110,
      })
    )
    const intent = await interpretMessage('investi 1000 no CDB a 110', '2026-09-11', TREE)
    expect(intent).toMatchObject({ kind: 'investment', rateType: null, rateValue: null })
  })

  it('investimento sem tipo declarado mantém investmentType null', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'investimento', investimento_nome: 'Tesouro', investimento_tipo: null, valor: 2000 })
    )
    expect(await interpretMessage('coloquei 2000 no tesouro', '2026-09-11', TREE))
      .toMatchObject({ kind: 'investment', investmentType: null, amount: 2000 })
  })
})

describe('interpretMessage — projeções', () => {
  it('projecao vira projection com categoria e valor', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'projecao', categoria: 'Mercado', valor: 800, mes: '2026-09', tipo: 'pf' })
    )
    const intent = await interpretMessage('projeção de mercado esse mês é 800', '2026-09-11', TREE)
    expect(intent).toMatchObject({
      kind: 'projection', category: 'Mercado', subcategory: null, amount: 800, month: '2026-09', type: 'pf',
    })
  })

  it('mês fora do formato YYYY-MM vira null (o agente usa o mês corrente)', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'projecao', categoria: 'Mercado', valor: 800, mes: 'setembro' })
    )
    expect(await interpretMessage('projeção de mercado é 800', '2026-09-11', TREE))
      .toMatchObject({ kind: 'projection', month: null })
  })

  it('projeção com subcategoria preserva as duas pontas', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'projecao', categoria: 'Mercado', subcategoria: 'Feira', valor: 300 })
    )
    expect(await interpretMessage('projeção da feira é 300', '2026-09-11', TREE))
      .toMatchObject({ kind: 'projection', category: 'Mercado', subcategory: 'Feira', amount: 300 })
  })
})

describe('interpretMessage — metas', () => {
  it('meta com nome vira goal_query com o nome falado', async () => {
    createMock.mockResolvedValue(toolResponse({ intencao: 'meta', meta: 'viagem' }))
    expect(await interpretMessage('quanto falta pra minha meta de viagem?', '2026-09-11', TREE))
      .toEqual({ kind: 'goal_query', goal: 'viagem' })
  })

  it('meta sem nome vira goal_query com goal null (todas as metas)', async () => {
    createMock.mockResolvedValue(toolResponse({ intencao: 'meta', meta: null }))
    expect(await interpretMessage('como estão minhas metas?', '2026-09-11', TREE))
      .toEqual({ kind: 'goal_query', goal: null })
  })
})

describe('interpretMessage — custo', () => {
  it('os intents novos entram no mesmo tool: uma chamada de LLM por mensagem', async () => {
    createMock.mockResolvedValue(
      toolResponse({ intencao: 'guardar_reserva', reserva: 'emergência', valor: 500 })
    )
    await interpretMessage('guardei 500 na reserva de emergência', '2026-09-11', TREE)
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock.mock.calls[0][0].tools[0].name).toBe('registrar_intencao')
  })
})
