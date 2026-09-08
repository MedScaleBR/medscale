import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, sentMessages, lastSentMessage } from '../helpers/agent-harness'
import type { RecordedCall, SupabaseMockConfig } from '../helpers/supabase-mock'

// Lote de lançamentos: uma mensagem pode citar vários gastos, e cada um pode
// estar incompleto (sem tipo, sem valor, sem unidade). O interpretador é
// mockado inteiro — o que se exercita aqui é o mecanismo de conversa do agente.
const h = vi.hoisted(() => ({ intent: null as unknown }))

vi.mock('@/lib/supabase/server', async () => {
  const harness = await import('../helpers/agent-harness')
  return { createAdminClient: () => harness.state.supabase.client, createClient: async () => harness.state.supabase.client }
})
vi.mock('@/lib/whatsapp/send', async () => {
  const harness = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: harness.sendWhatsAppMessage }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const harness = await import('../helpers/agent-harness')
  return { default: class { messages = { create: harness.claudeCreate } } }
})
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn() }))
vi.mock('@/lib/finance/interpret', () => ({ interpretMessage: vi.fn(async () => h.intent) }))
vi.mock('@/lib/finance/categorize', () => ({ categorizeEntry: vi.fn(async () => ({ categoryName: null, subcategoryName: null })) }))

const CAT_ROWS = [
  { id: 'ali', account_id: PARAMS.accountId, kind: 'pf', direction: 'out', parent_id: null, name: 'Alimentação', sort_order: 0, is_archived: false, created_at: '' },
]

function financeConfig(over: SupabaseMockConfig = {}) {
  return mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: CAT_ROWS } },
    finance_sessions: { select: { data: null }, upsert: { data: null }, update: { data: null } },
    // O insert devolve o payload gravado: a confirmação em lote lista
    // descrição e valor de cada linha, então uma linha fixa não serviria.
    finance_entries: {
      select: { data: [] },
      insert: (call: RecordedCall) => ({ data: { id: 'e1', ...(call.payload as Record<string, unknown>) } }),
    },
    workspaces: { select: { data: [{ id: 'w1', name: 'Unidade A' }] } },
    ...over,
  })
}

// Relê o pending_entry do último upsert e o injeta como o que o agente vai
// encontrar na próxima mensagem — encadeia duas perguntas na mesma suíte.
// Reaplica a config inteira (mergeSupabaseConfig cria um mock novo), por isso
// recebe os overrides do teste.
function applyPendingFromLastUpsert(over: SupabaseMockConfig = {}) {
  const up = state.supabase.callsTo('finance_sessions', 'upsert').at(-1)
  const pending = (up?.payload as { pending_entry: unknown })?.pending_entry
  financeConfig({
    ...over,
    finance_sessions: {
      select: { data: { pending_entry: pending, last_message_at: new Date().toISOString() } },
      upsert: { data: null },
      update: { data: null },
    },
  })
}

beforeEach(() => {
  resetAgentHarness()
  h.intent = null
  process.env.FINANCE_PHONE_NUMBER_ID = 'pn-fin'
  process.env.FINANCE_META_TOKEN = 'tok-fin'
})

describe('processFinancialMessage — lote de lançamentos', () => {
  it('dois lançamentos prontos → dois inserts + uma confirmação em lote', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
        { type: 'pf', direction: 'out', description: 'Uber', amount: 50, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 50 no uber')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(2)
    const msgs = sentMessages()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('Registrei 2 lançamentos')
    expect(msgs[0]).toContain('iFood')
    expect(msgs[0]).toContain('Uber')
  })

  it('tipo ambíguo estaciona o lote e pergunta PF/PJ, sem gravar', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [{ type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null }],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 2600 no aluguel')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    const up = state.supabase.callsTo('finance_sessions', 'upsert')[0]
    expect((up.payload as { pending_entry: { kind: string; awaiting: string } }).pending_entry).toMatchObject({ kind: 'entry_batch', awaiting: 'type' })
    expect(lastSentMessage()).toContain('pessoal (PF) ou da clínica (PJ)')
  })

  it('resposta "pessoal" retoma e grava como PF', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'type', rawMessage: 'gastei 2600 no aluguel',
              current: { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
              queue: [],
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    h.intent = { kind: 'unknown', raw: 'pessoal' } // não deve ser usado — o handler intercepta antes
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'pessoal')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as { type: string }).type).toBe('pf')
  })

  it('item pronto antes do ambíguo é gravado e confirmado; a pergunta vem depois', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
        { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 2600 no aluguel')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(1)
    const msgs = sentMessages()
    expect(msgs.length).toBe(2)
    expect(msgs[1]).toContain('pessoal (PF) ou da clínica (PJ)')
  })

  it('valor faltando pergunta o valor e depois grava', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'amount', rawMessage: 'paguei o almoço',
              current: { type: 'pf', direction: 'out', description: 'almoço', amount: null, category: null, subcategory: null, workspaceHint: null },
              queue: [],
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, '32')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as { amount: number }).amount).toBe(32)
  })

  it('valor sem número pergunta de novo em vez de gravar', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'amount', rawMessage: 'paguei o almoço',
              current: { type: 'pf', direction: 'out', description: 'almoço', amount: null, category: null, subcategory: null, workspaceHint: null },
              queue: [],
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'acho que uns trinta')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Me manda só o número')
  })

  it('PJ multi-unidade encadeia a pergunta de unidade depois do tipo', async () => {
    const twoUnits: SupabaseMockConfig = {
      workspaces: { select: { data: [{ id: 'w1', name: 'Unidade A' }, { id: 'w2', name: 'Unidade B' }] } },
    }
    financeConfig(twoUnits)
    h.intent = {
      kind: 'entry',
      entries: [{ type: null, direction: 'out', description: 'material', amount: 400, category: null, subcategory: null, workspaceHint: null }],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 400 em material')
    // responde "clínica"
    applyPendingFromLastUpsert(twoUnits)
    await processFinancialMessage(PARAMS.patientPhone, 'clínica')

    expect(lastSentMessage()).toMatch(/unidade/i)
    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  })

  it('escolhida a unidade, o lançamento PJ é gravado nela', async () => {
    financeConfig({
      workspaces: { select: { data: [{ id: 'w1', name: 'Unidade A' }, { id: 'w2', name: 'Unidade B' }] } },
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'unit', rawMessage: 'gastei 400 em material',
              current: { type: 'pj', direction: 'out', description: 'material', amount: 400, category: null, subcategory: null, workspaceHint: null, categoryId: null, subcategoryId: null },
              queue: [],
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'Unidade B')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect(ins).toBeDefined()
    expect((ins.payload as { workspace_id: string }).workspace_id).toBe('w2')
  })

  it('NEGATIVE descarta current + queue mas mantém o que já entrou', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'type', rawMessage: 'x',
              current: { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
              queue: [{ type: null, direction: 'out', description: 'energia', amount: 300, category: null, subcategory: null, workspaceHint: null }],
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'deixa')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('não registrei o restante')
  })
})
