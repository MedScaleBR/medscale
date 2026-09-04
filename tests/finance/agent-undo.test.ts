import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS } from '../helpers/agent-harness'
import { filterValue, type RecordedCall } from '../helpers/supabase-mock'

// "apaga o último" (kind: 'undo') nunca pode pegar o espelho de um pagamento
// do ciclo de receita — só a API web tem essa trava (409 revenue_mirror_locked);
// o caminho do WhatsApp usa createAdminClient() direto, então precisa da
// mesma exclusão na própria query.
const h = vi.hoisted(() => ({ intent: { kind: 'undo' } as unknown }))

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

function financeConfig() {
  return mergeSupabaseConfig({
    memberships: { select: { data: [{ account_id: PARAMS.accountId, user_id: 'u1' }] } },
    profiles: { select: { data: [{ id: 'u1', phone: PARAMS.patientPhone }] } },
    accounts: { select: { data: { modules: ['finance'] } } },
    finance_categories: { select: { data: [] } },
    finance_sessions: { select: { data: null }, upsert: { data: null }, update: { data: null } },
    finance_entries: {
      select: { data: { id: 'e1', type: 'pf', direction: 'out', amount: 10, description: 'x', revenue_entry_id: null } },
      delete: { data: null },
    },
  })
}

describe('handleUndo — WhatsApp "apaga o último"', () => {
  beforeEach(() => {
    resetAgentHarness()
    h.intent = { kind: 'undo' }
  })

  it('exclui linhas do espelho do ciclo de receita da busca', async () => {
    financeConfig()
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'apaga o último')

    const sel = state.supabase.callsTo('finance_entries', 'select')[0] as RecordedCall
    expect(filterValue(sel, 'is', 'revenue_entry_id')).toBeNull()
  })
})
