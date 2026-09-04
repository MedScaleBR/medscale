import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, lastSentMessage } from '../helpers/agent-harness'
import { filterValue, type RecordedCall } from '../helpers/supabase-mock'

// Entradas do agente controladas pelo teste: interpretMessage/categorizeEntry
// devolvem NOMES; o que se verifica é o agente resolvendo nome -> id contra a
// árvore da conta e gravando category_id/subcategory_id.
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
// buildConfirmationMessage / buildQueryMessage instanciam o Anthropic client;
// o harness claudeCreate devolve texto padrão sem chamada real.
vi.mock('@anthropic-ai/sdk', async () => {
  const harness = await import('../helpers/agent-harness')
  return { default: class { messages = { create: harness.claudeCreate } } }
})
vi.mock('@/lib/finance/provision', () => ({ ensureFinanceCategories: vi.fn() }))
vi.mock('@/lib/finance/interpret', () => ({ interpretMessage: vi.fn(async () => h.intent) }))
vi.mock('@/lib/finance/categorize', () => ({ categorizeEntry: vi.fn(async () => h.categorize) }))

// Filhos -> Escola, ambos pf.
const CAT_ROWS = [
  { id: 'fil', account_id: PARAMS.accountId, kind: 'pf', direction: 'out', parent_id: null, name: 'Filhos', sort_order: 0, is_archived: false, created_at: '' },
  { id: 'esc', account_id: PARAMS.accountId, kind: 'pf', direction: 'out', parent_id: 'fil', name: 'Escola', sort_order: 0, is_archived: false, created_at: '' },
]

function financeConfig() {
  return mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: CAT_ROWS } },
    finance_sessions: { select: { data: null }, upsert: { data: null }, update: { data: null } },
    finance_entries: {
      select: { data: [] },
      insert: {
        data: {
          id: 'e1', type: 'pf', description: 'Escola do João', amount: 200,
          category: 'Filhos', category_id: 'fil', subcategory_id: 'esc',
          entry_date: '2026-09-01', workspace_id: null,
        },
      },
    },
  })
}

describe('processFinancialMessage — categorias', () => {
  beforeEach(() => {
    resetAgentHarness()
    h.intent = null
    h.categorize = { categoryName: null, subcategoryName: null }
    process.env.FINANCE_PHONE_NUMBER_ID = 'pn-fin'
    process.env.FINANCE_META_TOKEN = 'tok-fin'
  })

  it('grava category_id e subcategory_id resolvidos da árvore, com o nome como snapshot', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry', type: 'pf', description: 'Escola do João', amount: 200,
      category: 'Filhos', subcategory: 'Escola', workspaceHint: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 200 na escola do joão')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect(ins).toBeDefined()
    const p = ins.payload as Record<string, unknown>
    expect(p.category_id).toBe('fil')
    expect(p.subcategory_id).toBe('esc')
    expect(p.category).toBe('Filhos')
  })

  it('cai no categorizeEntry quando a interpretação não trouxe categoria, e ainda resolve id', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry', type: 'pf', description: 'material escolar do joão', amount: 90,
      category: null, subcategory: null, workspaceHint: null,
    }
    h.categorize = { categoryName: 'Filhos', subcategoryName: 'Escola' }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 90 em material escolar do joão')

    const p = state.supabase.callsTo('finance_entries', 'insert')[0].payload as Record<string, unknown>
    expect(p.category_id).toBe('fil')
    expect(p.subcategory_id).toBe('esc')
    expect(p.category).toBe('Filhos')
  })

  it('consulta por categoria filtra por category_id, não pelo texto', async () => {
    financeConfig()
    h.intent = {
      kind: 'query', type: 'pf', category: 'Filhos', subcategory: null,
      month: null, workspace: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'quanto gastei com os filhos esse mes')

    const sel = state.supabase
      .callsTo('finance_entries', 'select')
      .find((c: RecordedCall) => c.filters.some((f) => f[0] === 'eq' && f[1] === 'category_id'))
    expect(sel).toBeDefined()
    expect(filterValue(sel as RecordedCall, 'eq', 'category_id')).toBe('fil')
    expect((sel as RecordedCall).filters.some((f) => f[0] === 'eq' && f[1] === 'category')).toBe(false)
  })

  it('consulta de gasto filtra direction=out — não deixa receita entrar no total', async () => {
    financeConfig()
    h.intent = {
      kind: 'query', type: 'pf', category: 'Filhos', subcategory: null,
      month: null, workspace: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'quanto gastei com os filhos esse mes')

    const sel = state.supabase
      .callsTo('finance_entries', 'select')
      .find((c: RecordedCall) => c.filters.some((f) => f[0] === 'eq' && f[1] === 'category_id'))
    expect(sel).toBeDefined()
    expect(filterValue(sel as RecordedCall, 'eq', 'direction')).toBe('out')
  })

  it('consulta com categoria fora da árvore responde "não encontrei" e não roda a query ampla', async () => {
    financeConfig()
    h.intent = {
      kind: 'query', type: 'pf', category: 'Criptomoedas', subcategory: null,
      month: null, workspace: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'quanto gastei em cripto esse mes')

    // Sem o filtro resolvido, rodar getEntries devolveria o total do mês
    // inteiro como se respondesse — o agente precisa cair fora antes disso.
    expect(state.supabase.callsTo('finance_entries', 'select')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Não encontrei a categoria "Criptomoedas"')
  })

  it('consulta com categoria válida mas subcategoria inexistente ainda consulta a categoria', async () => {
    financeConfig()
    h.intent = {
      kind: 'query', type: 'pf', category: 'Filhos', subcategory: 'Mesada',
      month: null, workspace: null,
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'quanto gastei com mesada dos filhos esse mes')

    const sel = state.supabase
      .callsTo('finance_entries', 'select')
      .find((c: RecordedCall) => c.filters.some((f) => f[0] === 'eq' && f[1] === 'category_id'))
    expect(sel).toBeDefined()
    expect(filterValue(sel as RecordedCall, 'eq', 'category_id')).toBe('fil')
    expect((sel as RecordedCall).filters.some((f) => f[0] === 'eq' && f[1] === 'subcategory_id')).toBe(false)
  })
})
