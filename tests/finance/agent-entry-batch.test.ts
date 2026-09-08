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

  it('insert que falha no meio do lote é avisado junto com a confirmação', async () => {
    financeConfig({
      // 1º insert falha, 2º passa — o array de respostas é consumido em ordem.
      finance_entries: {
        select: { data: [] },
        insert: [
          { data: null, error: { message: 'boom' } },
          {
            data: {
              id: 'e2', type: 'pf', direction: 'out', description: 'Uber', amount: 50,
              category: null, category_id: null, subcategory_id: null, entry_date: '2026-09-08', workspace_id: null,
            },
          },
        ],
      },
    })
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
    const msg = lastSentMessage() ?? ''
    // A confirmação do que entrou continua vindo…
    expect(msg).toContain('Resposta padrão do teste.')
    // …mas o que se perdeu não pode passar em silêncio.
    expect(msg).toContain('não foi registrado')
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

  // Um item que só o interpretador viu não existe em lugar nenhum além do
  // pending_entry — se ele não for para a `queue` do registro estacionado, some.
  it('o item ainda não olhado entra na queue do pending estacionado', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
        { type: 'pf', direction: 'out', description: 'Uber', amount: 50, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 2600 no aluguel e 50 no uber')

    const up = state.supabase.callsTo('finance_sessions', 'upsert').at(-1)
    const pending = (up?.payload as { pending_entry: { current: unknown; queue: unknown[] } }).pending_entry
    expect(pending.current).toMatchObject({ description: 'aluguel', type: null })
    expect(pending.queue).toHaveLength(1)
    expect(pending.queue[0]).toMatchObject({ description: 'Uber', type: 'pf', amount: 50 })
  })

  it('respondido o tipo, o item estacionado E o da queue são gravados e confirmados juntos', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
        { type: 'pf', direction: 'out', description: 'Uber', amount: 50, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 2600 no aluguel e 50 no uber')
    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)

    // O owner responde "pessoal" — o lote inteiro volta ao laço de drenagem.
    applyPendingFromLastUpsert()
    await processFinancialMessage(PARAMS.patientPhone, 'pessoal')

    const ins = state.supabase.callsTo('finance_entries', 'insert')
    expect(ins).toHaveLength(2)
    expect(ins.map((c) => (c.payload as { description: string }).description)).toEqual(['aluguel', 'Uber'])
    const msg = lastSentMessage() ?? ''
    expect(msg).toContain('Registrei 2 lançamentos')
    expect(msg).toContain('aluguel')
    expect(msg).toContain('Uber')
  })

  // batchTotals consulta um total por bucket (tipo + direção) distinto: um lote
  // PF + PJ tem que render duas linhas de total, não uma nem quatro.
  it('lote PF + PJ confirma com uma linha de total por bucket', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [
        { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
        { type: 'pj', direction: 'out', description: 'Material', amount: 400, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 400 em material da clínica')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(2)
    const msg = lastSentMessage() ?? ''
    const totais = msg.split('\n').filter((l) => /^(Despesas|Receitas) (PF|PJ) em /.test(l))
    expect(totais).toHaveLength(2)
    expect(totais.some((l) => l.startsWith('Despesas PF'))).toBe(true)
    expect(totais.some((l) => l.startsWith('Despesas PJ'))).toBe(true)
  })

  it('lote inteiro que falha no insert avisa no plural', async () => {
    financeConfig({
      finance_entries: {
        select: { data: [] },
        insert: { data: null, error: { message: 'boom' } },
      },
    })
    h.intent = {
      kind: 'entry',
      entries: [
        { type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null },
        { type: 'pf', direction: 'out', description: 'Uber', amount: 50, category: null, subcategory: null, workspaceHint: null },
      ],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood e 50 no uber')

    expect(lastSentMessage()).toContain('Erro ao registrar os lançamentos')
  })

  // O lote expirado é descartado em silêncio: 30 minutos depois, a mensagem
  // quase certamente é outro assunto, não a resposta à pergunta.
  it('lote expirado não consome a mensagem — ela segue para a interpretação', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'entry_batch', awaiting: 'type', rawMessage: 'gastei 2600 no aluguel',
              current: { type: null, direction: 'out', description: 'aluguel', amount: 2600, category: null, subcategory: null, workspaceHint: null },
              queue: [],
            },
            last_message_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    h.intent = {
      kind: 'entry',
      entries: [{ type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null }],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood')

    // A pendência foi limpa…
    const clear = state.supabase.callsTo('finance_sessions', 'update')[0]
    expect((clear?.payload as { pending_entry: unknown })?.pending_entry).toBeNull()
    // …e a mensagem foi interpretada do zero, não lida como resposta de tipo.
    const ins = state.supabase.callsTo('finance_entries', 'insert')
    expect(ins).toHaveLength(1)
    expect((ins[0].payload as { description: string }).description).toBe('iFood')
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
    // Sem a dica, a única saída do laço é uma palavra que ninguém contou.
    expect(lastSentMessage()).toContain('responda "deixa"')
  })

  it('unidade não reconhecida repergunta com a dica de saída', async () => {
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
    await processFinancialMessage(PARAMS.patientPhone, 'a do centro talvez')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Não reconheci essa unidade')
    expect(lastSentMessage()).toContain('responda "deixa"')
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
    // /unidade/i também casaria com buildWorkspaceNotMatchedMessage — o que
    // prova o encadeamento é a pendência ter avançado para 'unit'.
    const up = state.supabase.callsTo('finance_sessions', 'upsert').at(-1)
    expect((up?.payload as { pending_entry: { awaiting: string } }).pending_entry.awaiting).toBe('unit')
    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  })

  it('PJ com uma única unidade grava nela sem perguntar nada', async () => {
    financeConfig()
    h.intent = {
      kind: 'entry',
      entries: [{ type: 'pj', direction: 'out', description: 'material', amount: 400, category: null, subcategory: null, workspaceHint: null }],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 400 em material da clínica')

    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect(ins).toBeDefined()
    expect((ins.payload as { workspace_id: string }).workspace_id).toBe('w1')
    expect(state.supabase.callsTo('finance_sessions', 'upsert')).toHaveLength(0)
    expect(sentMessages()).toHaveLength(1)
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
    // "o restante" dava a entender que algo entrou — no caso de um lançamento
    // só estacionado, nada entrou.
    expect(lastSentMessage()).toContain('não registrei o que estava pendente')
  })

  it('"não sei" na pergunta de tipo repete a pergunta em vez de cancelar', async () => {
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
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'não sei')

    expect(lastSentMessage()).toContain('pessoal (PF) ou da clínica (PJ)')
    // Repergunta, mas dizendo como sair — senão toda resposta que não parseia
    // é consumida sem o owner saber que existe uma saída.
    expect(lastSentMessage()).toContain('responda "deixa"')
    // A pendência continua de pé — "não sei" é não-resposta, não desistência.
    expect(state.supabase.callsTo('finance_sessions', 'update')).toHaveLength(0)
    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
  })

  it('intent de lançamento sem nenhum item responde em vez de calar', async () => {
    financeConfig()
    h.intent = { kind: 'entry', entries: [] }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei')

    expect(state.supabase.callsTo('finance_entries', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Não peguei essa')
  })

  it('pendência antiga (choose_workspace) é limpa e a mensagem segue o fluxo normal', async () => {
    financeConfig({
      finance_sessions: {
        select: {
          data: {
            pending_entry: {
              kind: 'choose_workspace',
              entry: { type: 'pj', direction: 'out', description: 'material', amount: 400 },
            },
            last_message_at: new Date().toISOString(),
          },
        },
        upsert: { data: null }, update: { data: null },
      },
    })
    h.intent = {
      kind: 'entry',
      entries: [{ type: 'pf', direction: 'out', description: 'iFood', amount: 35, category: null, subcategory: null, workspaceHint: null }],
    }
    const { processFinancialMessage } = await import('@/lib/finance/agent')
    await processFinancialMessage(PARAMS.patientPhone, 'gastei 35 no ifood')

    const clear = state.supabase.callsTo('finance_sessions', 'update')[0]
    expect((clear?.payload as { pending_entry: unknown })?.pending_entry).toBeNull()
    // Seguiu para o interpretador: o lançamento novo foi gravado.
    const ins = state.supabase.callsTo('finance_entries', 'insert')[0]
    expect((ins?.payload as { description: string })?.description).toBe('iFood')
  })
})
