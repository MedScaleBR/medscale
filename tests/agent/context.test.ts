import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const h = await import('../helpers/agent-harness')
  return { createAdminClient: () => h.state.supabase.client, createClient: async () => h.state.supabase.client }
})
vi.mock('@/lib/bot/config', async () => {
  const h = await import('../helpers/agent-harness')
  return { getBotConfig: async () => h.state.botConfig, getAccountUnits: async () => h.state.units, invalidateBotConfigCache: () => {} }
})
vi.mock('@/lib/whatsapp/send', async () => {
  const h = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: h.sendWhatsAppMessage }
})
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => `decrypted:${t}`, encryptToken: (t: string) => t }))
vi.mock('@/lib/google/availability', async () => {
  const h = await import('../helpers/agent-harness')
  return { getFreeSlotsForBot: h.getFreeSlotsForBot, isSlotAvailable: h.isSlotAvailable }
})
vi.mock('@/lib/google/auth', async () => {
  const h = await import('../helpers/agent-harness')
  return { isGoogleConnected: async () => ({ connected: h.state.googleConnected, email: h.state.googleEmail }) }
})
vi.mock('@/lib/google/calendar', async () => {
  const h = await import('../helpers/agent-harness')
  return { createEvent: h.createEvent, cancelEvent: h.cancelEvent }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const h = await import('../helpers/agent-harness')
  return { default: class { messages = { create: h.claudeCreate } } }
})

import { processIncomingMessage, handleUnsupportedMessage } from '@/lib/llm/agent'
import {
  resetAgentHarness,
  mergeSupabaseConfig,
  state,
  claudeCreate,
  sendWhatsAppMessage,
  PARAMS,
  UNIT,
  DEFAULT_BOT_CONFIG,
  lastSentMessage,
} from '../helpers/agent-harness'

/** System prompt enviado ao Claude na chamada mais recente. */
function systemPrompt(): string {
  const calls = claudeCreate.mock.calls as unknown as Array<[{ system: string }]>
  return calls.at(-1)?.[0]?.system ?? ''
}

/** Mensagens da conversa enviadas ao Claude na chamada mais recente. */
function claudeMessages(): Array<{ role: string; content: string }> {
  const calls = claudeCreate.mock.calls as unknown as Array<[{ messages: Array<{ role: string; content: string }> }]>
  return calls.at(-1)?.[0]?.messages ?? []
}

describe('processIncomingMessage — montagem de contexto', () => {
  beforeEach(() => {
    resetAgentHarness()
  })

  it('não deve chamar o Claude quando a conversa está com bot_paused', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: { select: { data: { id: 'c1', status: 'open', bot_paused: true, archived_at: null } } },
    })

    await processIncomingMessage(PARAMS)

    expect(claudeCreate).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    // A mensagem do paciente ainda é registrada — a equipe precisa vê-la.
    const inserted = supabase.callsTo('messages', 'insert')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload).toMatchObject({ role: 'user', content: PARAMS.message })
  })

  it('não deve chamar o Claude quando o bot_config está inativo', async () => {
    mergeSupabaseConfig({})
    state.botConfig = { ...DEFAULT_BOT_CONFIG, isActive: false }

    await processIncomingMessage(PARAMS)

    expect(claudeCreate).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('não deve chamar o Claude quando não existe bot_config para a workspace', async () => {
    mergeSupabaseConfig({})
    state.botConfig = null

    await processIncomingMessage(PARAMS)

    expect(claudeCreate).not.toHaveBeenCalled()
  })

  it('deve criar o paciente com full_name "Paciente" quando é o primeiro contato', async () => {
    const supabase = mergeSupabaseConfig({
      patients: {
        select: { data: null }, // não existe ainda
        insert: { data: { id: 'p-novo', full_name: 'Paciente' } },
      },
    })
    state.claudeResponses = ['Olá! Sou a Maria.']

    await processIncomingMessage(PARAMS)

    const insert = supabase.callsTo('patients', 'insert')[0]
    expect(insert?.payload).toEqual({
      account_id: PARAMS.accountId,
      phone: PARAMS.patientPhone,
      full_name: 'Paciente',
    })
  })

  it('deve reaproveitar o paciente vencedor quando dois inserts concorrem no mesmo telefone', async () => {
    // 23505 = unique_violation: outra mensagem criou o paciente no meio do caminho.
    const supabase = mergeSupabaseConfig({
      patients: {
        select: [{ data: null }, { data: { id: 'p-existente', full_name: 'Paciente' } }],
        insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
      },
    })
    state.claudeResponses = ['Olá!']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('patients', 'select')).toHaveLength(2)
    expect(claudeCreate).toHaveBeenCalled()
  })

  it('deve reabrir a conversa para "open" quando ela estava resolved e chega mensagem nova', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: { select: { data: { id: 'c1', status: 'resolved', bot_paused: false, archived_at: null } } },
    })
    state.claudeResponses = ['Oi de novo!']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('conversations', 'update')[0]
    expect(update?.payload).toMatchObject({ status: 'open', resolved_at: null })
  })

  it('deve manter a conversa pausada e não reabrir quando está resolved com bot_paused', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: { select: { data: { id: 'c1', status: 'resolved', bot_paused: true, archived_at: null } } },
    })

    await processIncomingMessage(PARAMS)

    const reopened = supabase
      .callsTo('conversations', 'update')
      .filter((c) => (c.payload as { status?: string }).status === 'open')
    expect(reopened).toHaveLength(0)
    expect(claudeCreate).not.toHaveBeenCalled()
  })

  it('deve desarquivar a conversa quando chega mensagem nova de um número arquivado', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: {
        select: { data: { id: 'c1', status: 'open', bot_paused: false, archived_at: '2025-01-01T00:00:00Z' } },
      },
    })
    state.claudeResponses = ['Oi!']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('conversations', 'update')[0]
    expect(update?.payload).toMatchObject({ archived_at: null })
  })

  it('deve criar a conversa quando o paciente nunca escreveu para esta workspace', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: {
        select: { data: null },
        insert: { data: { id: 'c-nova', status: 'open', bot_paused: false, archived_at: null } },
      },
    })
    state.claudeResponses = ['Olá!']

    await processIncomingMessage(PARAMS)

    const insert = supabase.callsTo('conversations', 'insert')[0]
    // workspace_id fica NULL na criação — só é definido quando a Maria confirma
    // a unidade (a account tem um número único).
    expect(insert?.payload).toMatchObject({
      account_id: PARAMS.accountId,
      patient_phone: PARAMS.patientPhone,
    })
    expect(insert?.payload).not.toHaveProperty('workspace_id')
  })

  it('deve incluir a instrução de boas-vindas no prompt quando é a primeira mensagem', async () => {
    mergeSupabaseConfig({
      messages: { insert: { data: null }, select: { data: [{ role: 'user', content: PARAMS.message }] } },
    })
    state.claudeResponses = ['Olá! Sou a Maria.']

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).toContain('Primeira mensagem desta conversa')
    expect(systemPrompt()).toContain(DEFAULT_BOT_CONFIG.welcomeMessage)
  })

  it('não deve incluir a instrução de boas-vindas quando a conversa já tem histórico', async () => {
    mergeSupabaseConfig({
      messages: {
        insert: { data: null },
        // Ordem descendente, como vem do banco.
        select: {
          data: [
            { role: 'user', content: 'Quero segunda de manhã' },
            { role: 'assistant', content: 'Tenho 08:00 e 09:00' },
            { role: 'user', content: 'Oi, quero marcar' },
          ],
        },
      },
    })
    state.claudeResponses = ['Perfeito!']

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).not.toContain('Primeira mensagem desta conversa')
  })

  it('deve enviar o histórico ao Claude em ordem cronológica começando por uma mensagem do paciente', async () => {
    mergeSupabaseConfig({
      messages: {
        insert: { data: null },
        select: {
          data: [
            { role: 'user', content: 'Quero segunda de manhã' },
            { role: 'assistant', content: 'Tenho 08:00 e 09:00' },
            { role: 'user', content: 'Oi, quero marcar' },
          ],
        },
      },
    })
    state.claudeResponses = ['Perfeito!']

    await processIncomingMessage(PARAMS)

    expect(claudeMessages()).toEqual([
      { role: 'user', content: 'Oi, quero marcar' },
      { role: 'assistant', content: 'Tenho 08:00 e 09:00' },
      { role: 'user', content: 'Quero segunda de manhã' },
    ])
  })

  it('deve descartar um "assistant" órfão no começo da janela de histórico', async () => {
    // A API da Anthropic exige que a lista comece com role "user".
    mergeSupabaseConfig({
      messages: {
        insert: { data: null },
        select: {
          data: [
            { role: 'user', content: 'Pode ser 09:00' },
            { role: 'assistant', content: 'Tenho 08:00 e 09:00' },
          ],
        },
      },
    })
    state.claudeResponses = ['Fechado!']

    await processIncomingMessage(PARAMS)

    expect(claudeMessages()[0]).toMatchObject({ role: 'user' })
  })

  it('deve incluir no prompt os horários livres calculados para os próximos dias', async () => {
    mergeSupabaseConfig({})
    state.freeSlots = { '*': ['08:00', '08:30'] }
    state.claudeResponses = ['Tenho 08:00 e 08:30.']

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).toContain('08:00')
    expect(systemPrompt()).toContain('Horários disponíveis para agendamento')
  })

  it('deve seguir sem horários quando o cálculo de disponibilidade falha', async () => {
    mergeSupabaseConfig({})
    state.freeSlots = {}
    // getFreeSlotsForBot rejeitando não pode derrubar a conversa inteira.
    const { getFreeSlotsForBot } = await import('../helpers/agent-harness')
    const original = getFreeSlotsForBot.getMockImplementation()
    getFreeSlotsForBot.mockRejectedValue(new Error('Google fora do ar'))
    state.claudeResponses = ['Vou verificar e te aviso.']

    try {
      await processIncomingMessage(PARAMS)

      expect(systemPrompt()).toContain('Sem horários disponíveis')
      expect(lastSentMessage()).toBe('Vou verificar e te aviso.')
    } finally {
      getFreeSlotsForBot.mockImplementation(original!)
    }
  })

  it('deve tentar o Claude duas vezes e cair no fallback quando ele não devolve bloco de texto', async () => {
    mergeSupabaseConfig({})
    state.claudeResponses = [
      { content: [], stop_reason: 'end_turn' },
      { content: [], stop_reason: 'end_turn' },
    ]

    await processIncomingMessage(PARAMS)

    expect(claudeCreate).toHaveBeenCalledTimes(2)
    expect(lastSentMessage()).toBe('Não consegui processar sua mensagem. Pode repetir?')
  })

  it('deve usar a segunda resposta quando a primeira volta vazia', async () => {
    mergeSupabaseConfig({})
    state.claudeResponses = [{ content: [], stop_reason: 'end_turn' }, 'Oi! Como posso ajudar?']

    await processIncomingMessage(PARAMS)

    expect(claudeCreate).toHaveBeenCalledTimes(2)
    expect(lastSentMessage()).toBe('Oi! Como posso ajudar?')
  })

  it('deve escalar para humano e pausar o bot quando a resposta repete a última mensagem do bot', async () => {
    const supabase = mergeSupabaseConfig({
      messages: {
        insert: { data: null },
        select: {
          data: [
            { role: 'user', content: 'E agora?' },
            { role: 'assistant', content: 'Pode escolher outro horário?' },
            { role: 'user', content: 'Oi' },
          ],
        },
      },
    })
    state.claudeResponses = ['Pode escolher outro horário?']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('conversations', 'update').at(-1)
    expect(update?.payload).toMatchObject({ status: 'handoff', bot_paused: true })
    const log = supabase.callsTo('handoff_logs', 'insert')[0]
    expect(log?.payload).toMatchObject({ trigger_reason: 'bot_uncertain' })
    expect(lastSentMessage()).toContain('não estou conseguindo resolver isso sozinha')
  })

  it('não deve enviar nada pelo WhatsApp quando a account não tem número configurado', async () => {
    mergeSupabaseConfig({})
    state.botConfig = { ...DEFAULT_BOT_CONFIG, phoneNumberId: null, metaToken: null }
    state.claudeResponses = ['Olá!']

    await processIncomingMessage(PARAMS)

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('processIncomingMessage — trava de unidade (multi-unidade)', () => {
  // ids em formato UUID — o marcador UNIDADE_ID exige isso.
  const UNIT_A = { ...UNIT, id: 'aaaaaaaa-0000-0000-0000-00000000000a', name: 'Unidade A' }
  const UNIT_B = { ...UNIT, id: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Unidade B' }

  beforeEach(() => {
    resetAgentHarness()
    state.units = [UNIT_A, UNIT_B]
    state.freeSlots = { '*': ['08:00', '08:30'] }
  })

  it('grava a unidade na conversa assim que a Maria emite UNIDADE_ID', async () => {
    const supabase = mergeSupabaseConfig({})
    state.claudeResponses = [`Perfeito, vou te atender na Unidade B.\nUNIDADE_ID: ${UNIT_B.id}`]

    await processIncomingMessage(PARAMS)

    const update = supabase
      .callsTo('conversations', 'update')
      .find((c) => (c.payload as { workspace_id?: string }).workspace_id !== undefined)
    expect(update?.payload).toMatchObject({ workspace_id: UNIT_B.id })
  })

  it('com unidade corrente na conversa: prioriza no prompt mas segue vendo todas as unidades', async () => {
    const { getFreeSlotsForBot } = await import('../helpers/agent-harness')
    mergeSupabaseConfig({
      conversations: { select: { data: { id: 'c1', status: 'open', bot_paused: false, archived_at: null, workspace_id: UNIT_A.id } } },
    })
    state.claudeResponses = ['Tenho 08:00 e 08:30.']

    await processIncomingMessage(PARAMS)

    // Continua carregando os horários de TODAS as unidades.
    const unitsConsultadas = new Set((getFreeSlotsForBot.mock.calls as unknown as Array<[string]>).map((c) => c[0]))
    expect(unitsConsultadas).toEqual(new Set([UNIT_A.id, UNIT_B.id]))
    // O prompt marca a unidade corrente mas não nega as outras.
    expect(systemPrompt()).toContain('já mencionou a Unidade A')
    expect(systemPrompt()).toContain('NUNCA diga que não existem outras unidades')
    expect(systemPrompt()).toContain('Unidade B')
  })
})

describe('handleUnsupportedMessage — mídia que a Maria não entende', () => {
  const unsupportedParams = {
    accountId: PARAMS.accountId,
    patientPhone: PARAMS.patientPhone,
    messageType: 'audio',
    whatsappMessageId: 'wamid.audio',
  }

  beforeEach(() => {
    resetAgentHarness()
  })

  it('deve registrar a mídia recebida e pedir texto ao paciente', async () => {
    const supabase = mergeSupabaseConfig({})

    await handleUnsupportedMessage(unsupportedParams)

    const inseridas = supabase.callsTo('messages', 'insert')
    expect(inseridas[0].payload).toMatchObject({ role: 'user', content: '[áudio recebido]' })
    expect(lastSentMessage()).toContain('só consigo entender mensagens em texto')
    expect(claudeCreate).not.toHaveBeenCalled()
  })

  it('deve usar o rótulo genérico para um tipo de mídia desconhecido', async () => {
    const supabase = mergeSupabaseConfig({})

    await handleUnsupportedMessage({ ...unsupportedParams, messageType: 'reaction' })

    expect(supabase.callsTo('messages', 'insert')[0].payload).toMatchObject({
      content: '[esse tipo de mensagem recebido]',
    })
  })

  it('deve apenas registrar, sem responder, quando o bot está pausado', async () => {
    const supabase = mergeSupabaseConfig({
      conversations: { select: { data: { id: 'c1', status: 'open', bot_paused: true, archived_at: null } } },
    })

    await handleUnsupportedMessage(unsupportedParams)

    expect(supabase.callsTo('messages', 'insert')).toHaveLength(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('não deve fazer nada quando o bot está inativo', async () => {
    const supabase = mergeSupabaseConfig({})
    state.botConfig = { ...DEFAULT_BOT_CONFIG, isActive: false }

    await handleUnsupportedMessage(unsupportedParams)

    expect(supabase.callsTo('messages', 'insert')).toHaveLength(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('não deve enviar resposta quando a account não tem WhatsApp configurado', async () => {
    mergeSupabaseConfig({})
    state.botConfig = { ...DEFAULT_BOT_CONFIG, phoneNumberId: null, metaToken: null }

    await handleUnsupportedMessage(unsupportedParams)

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
