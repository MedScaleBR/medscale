import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS } from '../helpers/agent-harness'
import { filterValue, type RecordedCall, type SupabaseMockConfig } from '../helpers/supabase-mock'

// Registrar e consultar receita pelo WhatsApp — Plano 2 (agente). Mesmo
// harness/mocking de agent-category.test.ts: interpretMessage/categorizeEntry
// controlados pelo teste, parser.ts (/pf+ etc.) roda de verdade.
const h = vi.hoisted(() => ({
  intent: null as unknown,
  categorize: { categoryName: null as string | null, subcategoryName: null as string | null },
}))

vi.mock('@/lib/supabase/server', async () => {
  const harness = await import('../helpers/agent-harness')
  return {
    createAdminClient: () => harness.state.supabase.client,
    createClient: async () => harness.state.supabase.client,
  }
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
vi.mock('@/lib/finance/categorize', () => ({ categorizeEntry: vi.fn(async () => h.categorize) }))

// PF: despesa "Filhos" e receita "Salário". PJ: despesa "Aluguel" e receita
// "Consultas particulares" (2 unidades, para exercitar o fluxo "qual unidade?").
const CAT_ROWS = [
  { id: 'fil', account_id: PARAMS.accountId, kind: 'pf', direction: 'out', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'sal', account_id: PARAMS.accountId, kind: 'pf', direction: 'in', parent_id: null, name: 'Salário / Pró-labore', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'alu', account_id: PARAMS.accountId, kind: 'pj', direction: 'out', parent_id: null, name: 'Aluguel', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'rec', account_id: PARAMS.accountId, kind: 'pj', direction: 'in', parent_id: null, name: 'Consultas particulares', sort_order: 0, is_archived: false, created_at: '' },
]

const UNITS = [
  { id: 'w1', name: 'Moema', account_id: PARAMS.accountId, is_active: true, display_order: 0 },
  { id: 'w2', name: 'Pinheiros', account_id: PARAMS.accountId, is_active: true, display_order: 1 },
]

function financeConfig(overrides: SupabaseMockConfig = {}) {
  return mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: CAT_ROWS } },
    finance_sessions: { select: { data: null }, upsert: { data: null }, update: { data: null } },
    workspaces: { select: { data: UNITS } },
    finance_entries: {
      select: { data: [] },
      insert: {
        data: {
          id: 'e1', type: 'pf', direction: 'in', description: 'Aluguel recebido', amount: 3000,
          category: 'Salário / Pró-labore', category_id: 'sal', subcategory_id: null,
          entry_date: '2026-09-04', workspace_id: null,
        },
      },
    },
    ...overrides,
  })
}

beforeEach(() => {
  resetAgentHarness()
  h.intent = null
  h.categorize = { categoryName: null, subcategoryName: null }
  process.env.FINANCE_PHONE_NUMBER_ID = 'pn-fin'
  process.env.FINANCE_META_TOKEN = 'tok-fin'
})

describe('registrar receita', () => {
  it('linguagem natural "recebi 3000 de aluguel" grava direction=in com categoria de receita', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry', type: 'pf', direction: 'in', description: 'Aluguel recebido', amount: 3000,
      category: 'Salário / Pró-labore', subcategory: null, workspaceHint: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'recebi 3000 de aluguel')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect(ins).toBeDefined()
    const p = ins.payload as Record<string, unknown>
    expect(p.direction).toBe('in')
    expect(p.category_id).toBe('sal')
    expect(p.amount).toBe(3000)
  })

  it('/pf+ (atalho, sem categoria) cai no categorizeEntry com direction=in', async () => {
    financeConfig()
    h.categorize = { categoryName: 'Salário / Pró-labore', subcategoryName: null }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    const { categorizeEntry } = await import('@/lib/finance/categorize')
    await processFinancialMessage(PARAMS.patientPhone, '/pf+ Aluguel recebido 3000')

    expect(categorizeEntry).toHaveBeenCalledWith('Aluguel recebido', 'pf', 'in', expect.anything())
    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins.payload as Record<string, unknown>).direction).toBe('in')
    expect((ins.payload as Record<string, unknown>).category_id).toBe('sal')
  })

  it('receita PJ com 2 unidades pergunta qual unidade em vez de gravar direto', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry', type: 'pj', direction: 'in', description: 'Consulta particular', amount: 500,
      category: 'Consultas particulares', subcategory: null, workspaceHint: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'recebi 500 de consulta particular')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    const upsert = state.supabase.callsTo('finance_sessions', 'upsert')[0]
    const pending = (upsert.payload as Record<string, unknown>).pending_entry as Record<string, unknown>
    expect((pending.entry as Record<string, unknown>).direction).toBe('in')
  })

  it('resposta escolhendo a unidade persiste a receita PJ pendente com direction=in', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'choose_workspace',
              entry: {
                type: 'pj', direction: 'in', description: 'Consulta particular', amount: 500,
                category: 'Consultas particulares', category_id: 'rec', subcategory_id: null,
                raw_message: 'recebi 500 de consulta particular',
              },
            },
            last_message_at: new Date().toISOString(),
          },
        },
        update: { data: null },
      },
    })
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'Moema')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect(ins).toBeDefined()
    const p = ins.payload as Record<string, unknown>
    expect(p.direction).toBe('in')
    expect(p.workspace_id).toBe('w1')
    expect(p.category_id).toBe('rec')
  })
})

describe('consultar receita', () => {
  it('"quanto recebi esse mês" filtra finance_entries por direction=in', async () => {
    financeConfig()
    h.intent = {
      kind: 'query', type: 'pf', direction: 'in', category: null, subcategory: null, month: null, workspace: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'quanto recebi esse mês')

    const sel = state.supabase.callsTo('finance_entries', 'select')[0] as RecordedCall
    expect(filterValue(sel, 'eq', 'direction')).toBe('in')
  })

  it('/resumo pf+ filtra finance_entries por direction=in', async () => {
    financeConfig()
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, '/resumo pf+')

    const sel = state.supabase.callsTo('finance_entries', 'select')[0] as RecordedCall
    expect(filterValue(sel, 'eq', 'direction')).toBe('in')
  })
})
