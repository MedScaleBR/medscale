import { describe, it, expect } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import {
  handlePatrimonioIntent,
  resumeReserveMovement,
  type PatrimonioCtx,
  type PendingReserveMovement,
} from '@/lib/finance/agent-patrimonio'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const TREE: FinanceCategoryTree = {
  pf: [
    {
      id: 'pf-mer', name: 'Mercado', direction: 'out', sortOrder: 0, isArchived: false, isEssential: true,
      children: [
        { id: 'pf-mer-feira', name: 'Feira', direction: 'out', sortOrder: 0, isArchived: false, isEssential: true, children: [] },
      ],
    },
  ],
  pj: [],
}

const CTX: PatrimonioCtx = { accountId: 'a1', categoryTree: TREE, today: '2026-09-11' }

function mock(config: SupabaseMockConfig = {}) {
  return createSupabaseMock(config)
}

// O client do mock não carrega os genéricos do Database; as rotas e o agente
// só precisam do builder encadeável.
type Client = Parameters<typeof handlePatrimonioIntent>[0]
const asClient = (m: ReturnType<typeof mock>) => m.client as unknown as Client

const RESERVE = {
  id: 'r1', account_id: 'a1', kind: 'pf', name: 'Reserva de emergência',
  archived_at: null, created_at: '2026-01-01',
}

describe('handlePatrimonioIntent — reservas', () => {
  it('deposita na reserva que casa pelo nome falado e responde com o saldo', async () => {
    const m = mock({
      finance_reserves: { select: { data: [RESERVE] } },
      finance_reserve_movements: {
        select: [
          { data: [{ id: 'm0', reserve_id: 'r1', amount: 1000, type: 'deposit' }] }, // loadReserves
          { data: [
            { id: 'm0', reserve_id: 'r1', amount: 1000, type: 'deposit' },
            { id: 'm1', reserve_id: 'r1', amount: 500, type: 'deposit' },
          ] }, // saldo depois do movimento
        ],
      },
    })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'reserve_deposit', reserve: 'emergencia', amount: 500, type: 'pf',
    })

    const insert = m.callsTo('finance_reserve_movements', 'insert')[0]
    expect(insert.payload).toMatchObject({
      account_id: 'a1', reserve_id: 'r1', amount: 500, type: 'deposit', source: 'whatsapp',
    })
    expect(result?.pending).toBeNull()
    expect(result?.reply).toContain('Reserva de emergência')
    expect(result?.reply).toContain('1.500')
  })

  it('retirada grava type=withdrawal', async () => {
    const m = mock({
      finance_reserves: { select: { data: [RESERVE] } },
      finance_reserve_movements: { select: { data: [] } },
    })

    await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'reserve_withdrawal', reserve: 'emergência', amount: 300, type: 'pf',
    })

    expect(m.callsTo('finance_reserve_movements', 'insert')[0].payload)
      .toMatchObject({ type: 'withdrawal', amount: 300 })
  })

  // Regra do produto: reserva que não existe não é criada calada.
  it('reserva inexistente pergunta antes de criar e não grava nada', async () => {
    const m = mock({ finance_reserves: { select: { data: [RESERVE] } }, finance_reserve_movements: { select: { data: [] } } })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'reserve_deposit', reserve: 'carro novo', amount: 500, type: 'pf',
    })

    expect(m.callsTo('finance_reserve_movements', 'insert')).toHaveLength(0)
    expect(m.callsTo('finance_reserves', 'insert')).toHaveLength(0)
    expect(result?.pending).toMatchObject({
      kind: 'reserve_movement', awaiting: 'create_confirm', reserveName: 'carro novo', amount: 500,
    })
  })

  it('reserva conhecida sem valor pergunta o valor', async () => {
    const m = mock({ finance_reserves: { select: { data: [RESERVE] } }, finance_reserve_movements: { select: { data: [] } } })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'reserve_deposit', reserve: 'emergência', amount: null, type: 'pf',
    })

    expect(m.callsTo('finance_reserve_movements', 'insert')).toHaveLength(0)
    expect(result?.pending).toMatchObject({ awaiting: 'amount', reserveId: 'r1' })
  })

  it('nome ambíguo mostra as candidatas sem gravar', async () => {
    const m = mock({
      finance_reserves: {
        select: {
          data: [
            { ...RESERVE, id: 'r1', name: 'Viagem Europa' },
            { ...RESERVE, id: 'r2', name: 'Viagem Japão' },
          ],
        },
      },
      finance_reserve_movements: { select: { data: [] } },
    })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'reserve_deposit', reserve: 'viagem', amount: 200, type: 'pf',
    })

    expect(m.callsTo('finance_reserve_movements', 'insert')).toHaveLength(0)
    expect(result?.reply).toContain('Viagem Europa')
    expect(result?.reply).toContain('Viagem Japão')
  })
})

describe('resumeReserveMovement', () => {
  const pendingCreate: PendingReserveMovement = {
    kind: 'reserve_movement', awaiting: 'create_confirm', movement: 'deposit',
    reserveId: null, reserveName: 'carro novo', entryKind: 'pf', amount: 500,
  }

  it('"sim" cria a reserva e grava o movimento', async () => {
    const m = mock({
      finance_reserves: { insert: { data: { id: 'r9', name: 'carro novo' } } },
      finance_reserve_movements: { select: { data: [{ id: 'm1', reserve_id: 'r9', amount: 500, type: 'deposit' }] } },
    })

    const result = await resumeReserveMovement(asClient(m), CTX, pendingCreate, {
      amount: null, affirmative: true, negative: false,
    })

    expect(m.callsTo('finance_reserves', 'insert')[0].payload)
      .toMatchObject({ account_id: 'a1', kind: 'pf', name: 'carro novo' })
    expect(m.callsTo('finance_reserve_movements', 'insert')[0].payload).toMatchObject({ reserve_id: 'r9', amount: 500 })
    expect(result?.pending).toBeNull()
  })

  it('"não" cancela sem criar nada', async () => {
    const m = mock()
    const result = await resumeReserveMovement(asClient(m), CTX, pendingCreate, {
      amount: null, affirmative: false, negative: true,
    })

    expect(m.callsTo('finance_reserves', 'insert')).toHaveLength(0)
    expect(m.callsTo('finance_reserve_movements', 'insert')).toHaveLength(0)
    expect(result?.pending).toBeNull()
  })

  it('resposta que não é sim nem não devolve null (a mensagem segue o fluxo normal)', async () => {
    const m = mock()
    const result = await resumeReserveMovement(asClient(m), CTX, pendingCreate, {
      amount: null, affirmative: false, negative: false,
    })
    expect(result).toBeNull()
  })

  it('criando sem valor, pergunta o valor com a reserva já criada', async () => {
    const m = mock({ finance_reserves: { insert: { data: { id: 'r9', name: 'carro novo' } } } })

    const result = await resumeReserveMovement(
      asClient(m),
      CTX,
      { ...pendingCreate, amount: null },
      { amount: null, affirmative: true, negative: false }
    )

    expect(m.callsTo('finance_reserve_movements', 'insert')).toHaveLength(0)
    expect(result?.pending).toMatchObject({ awaiting: 'amount', reserveId: 'r9' })
  })

  it('aguardando valor, o número recebido vira o movimento', async () => {
    const m = mock({
      finance_reserve_movements: { select: { data: [{ id: 'm1', reserve_id: 'r1', amount: 250, type: 'deposit' }] } },
    })

    const pending: PendingReserveMovement = {
      kind: 'reserve_movement', awaiting: 'amount', movement: 'deposit',
      reserveId: 'r1', reserveName: 'Reserva de emergência', entryKind: 'pf', amount: null,
    }
    const result = await resumeReserveMovement(asClient(m), CTX, pending, {
      amount: 250, affirmative: false, negative: false,
    })

    expect(m.callsTo('finance_reserve_movements', 'insert')[0].payload).toMatchObject({ reserve_id: 'r1', amount: 250 })
    expect(result?.pending).toBeNull()
  })
})

describe('handlePatrimonioIntent — investimentos', () => {
  it('grava a taxa quando ela veio completa', async () => {
    const m = mock({
      finance_investments: {
        insert: {
          data: {
            id: 'i1', account_id: 'a1', kind: 'pf', name: 'CDB Banco X', type: 'renda_fixa',
            invested_amount: 1000, current_value: null, rate_type: 'pct_cdi', rate_value: 110,
            start_date: '2026-09-11', maturity_date: null, note: null, created_at: '', updated_at: '',
          },
        },
      },
    })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'investment', name: 'CDB Banco X', investmentType: 'renda_fixa',
      amount: 1000, rateType: 'pct_cdi', rateValue: 110, type: 'pf',
    })

    expect(m.callsTo('finance_investments', 'insert')[0].payload).toMatchObject({
      account_id: 'a1', name: 'CDB Banco X', type: 'renda_fixa',
      invested_amount: 1000, rate_type: 'pct_cdi', rate_value: 110, start_date: '2026-09-11',
    })
    expect(result?.reply).toContain('CDB Banco X')
  })

  // Nunca inventar rendimento.
  it('sem taxa completa grava rate_type/rate_value nulos', async () => {
    const m = mock({ finance_investments: { insert: { data: null } } })

    await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'investment', name: 'Tesouro', investmentType: null,
      amount: 2000, rateType: 'pct_cdi', rateValue: null, type: 'pf',
    })

    expect(m.callsTo('finance_investments', 'insert')[0].payload)
      .toMatchObject({ type: 'outro', rate_type: null, rate_value: null })
  })

  it('investimento sem valor pergunta em vez de gravar', async () => {
    const m = mock()
    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'investment', name: 'CDB', investmentType: null,
      amount: null, rateType: null, rateValue: null, type: 'pf',
    })

    expect(m.callsTo('finance_investments', 'insert')).toHaveLength(0)
    expect(result?.pending).toBeNull()
  })
})

describe('handlePatrimonioIntent — projeções', () => {
  it('cria a projeção do mês corrente e responde com o realizado', async () => {
    const m = mock({
      finance_projections: { select: { data: null } },
      finance_entries: { select: { data: [{ amount: 320 }, { amount: 80 }] } },
    })

    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'projection', category: 'Mercado', subcategory: null, amount: 800, month: null, type: 'pf',
    })

    expect(m.callsTo('finance_projections', 'insert')[0].payload).toMatchObject({
      account_id: 'a1', category_id: 'pf-mer', subcategory_id: null,
      period_month: '2026-09-01', projected_amount: 800,
    })
    expect(result?.reply).toContain('400')
  })

  it('projeção já existente é atualizada, não duplicada', async () => {
    const m = mock({
      finance_projections: { select: { data: { id: 'p1' } } },
      finance_entries: { select: { data: [] } },
    })

    await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'projection', category: 'Mercado', subcategory: null, amount: 900, month: '2026-10', type: 'pf',
    })

    expect(m.callsTo('finance_projections', 'insert')).toHaveLength(0)
    expect(m.callsTo('finance_projections', 'update')[0].payload).toMatchObject({ projected_amount: 900 })
  })

  it('categoria fora da árvore não vira projeção', async () => {
    const m = mock()
    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'projection', category: 'Criptomoedas', subcategory: null, amount: 500, month: null, type: 'pf',
    })

    expect(m.callsTo('finance_projections', 'insert')).toHaveLength(0)
    expect(result?.reply).toContain('Criptomoedas')
  })

  it('sem valor, pergunta antes de gravar', async () => {
    const m = mock()
    const result = await handlePatrimonioIntent(asClient(m), CTX, {
      kind: 'projection', category: 'Mercado', subcategory: 'Feira', amount: null, month: null, type: 'pf',
    })

    expect(m.callsTo('finance_projections', 'insert')).toHaveLength(0)
    expect(result?.reply).toContain('Feira')
  })
})

describe('handlePatrimonioIntent — metas', () => {
  const AUTO_GOAL = {
    id: 'g1', account_id: 'a1', kind: 'pf', name: 'Reserva de 3 meses', mode: 'auto',
    target_amount: null, target_date: null, months_of_expenses: 3, linked_reserve_id: null,
    status: 'active', created_at: '', updated_at: '',
  }

  it('recalcula a meta automática a partir das projeções e do saldo atuais', async () => {
    const m = mock({
      finance_goals: { select: { data: [AUTO_GOAL] } },
      finance_reserves: { select: { data: [RESERVE] } },
      finance_reserve_movements: { select: { data: [{ id: 'm1', reserve_id: 'r1', amount: 1000, type: 'deposit' }] } },
      finance_investments: { select: { data: [] } },
      finance_projections: {
        select: { data: [{ category_id: 'pf-mer', subcategory_id: null, projected_amount: 2000 }] },
      },
    })

    const result = await handlePatrimonioIntent(asClient(m), CTX, { kind: 'goal_query', goal: 'reserva' })

    // 2000 projetado × 3 meses = 6000; 1000 guardado ⇒ faltam 5000.
    expect(result?.reply).toContain('6.000')
    expect(result?.reply).toContain('5.000')
  })

  it('conta sem metas responde que não há meta, sem inventar número', async () => {
    const m = mock({ finance_goals: { select: { data: [] } } })
    const result = await handlePatrimonioIntent(asClient(m), CTX, { kind: 'goal_query', goal: 'viagem' })
    expect(result?.reply).toBeTruthy()
    expect(m.callsTo('finance_projections', 'select')).toHaveLength(0)
  })

  it('nome que não casa com nenhuma meta lista as existentes', async () => {
    const m = mock({ finance_goals: { select: { data: [{ ...AUTO_GOAL, name: 'Carro' }] } } })
    const result = await handlePatrimonioIntent(asClient(m), CTX, { kind: 'goal_query', goal: 'viagem' })
    expect(result?.reply).toContain('Carro')
  })
})

describe('handlePatrimonioIntent — roteamento', () => {
  it('intent que não é de patrimônio devolve null (segue o fluxo de lançamentos)', async () => {
    const m = mock()
    const result = await handlePatrimonioIntent(asClient(m), CTX, { kind: 'entry', entries: [] })
    expect(result).toBeNull()
    expect(m.calls).toHaveLength(0)
  })
})
