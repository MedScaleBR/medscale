import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/whatsapp/send', async () => {
  const h = await import('../helpers/agent-harness')
  return { sendWhatsAppMessage: h.sendWhatsAppMessage }
})

import { detectHandoffIntent, isHandoffAvailableNow, executeHandoff, logHandoffUnavailable } from '@/lib/bot/handoff'
import { sendWhatsAppMessage } from '../helpers/agent-harness'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ handoff_hours: { select: { data: [], count: 0 } }, handoff_logs: { insert: { data: null } }, conversations: { update: { data: null } }, ...config })
  return g.supabase
}

describe('detectHandoffIntent — detecção de intenção de transferência', () => {
  it('deve retornar true quando o paciente escreve "quero falar com atendente"', () => {
    expect(detectHandoffIntent('Claro!', 'quero falar com atendente')).toEqual({
      needed: true,
      reason: 'user_request',
    })
  })

  it('deve retornar true quando o paciente escreve "humano"', () => {
    expect(detectHandoffIntent('Claro!', 'quero falar com um humano').needed).toBe(true)
  })

  it('deve retornar true para outras formas de pedir uma pessoa', () => {
    for (const frase of ['me passa a secretaria', 'quero ligar pra vocês', 'não quero robô', 'me chama no telefone']) {
      expect(detectHandoffIntent('Ok', frase).needed, frase).toBe(true)
    }
  })

  it('deve ignorar diferença de caixa alta na mensagem do paciente', () => {
    expect(detectHandoffIntent('Ok', 'QUERO FALAR COM ATENDENTE').needed).toBe(true)
  })

  it('deve retornar true com motivo bot_uncertain quando a resposta traz [HANDOFF]', () => {
    expect(detectHandoffIntent('[HANDOFF] Vou te passar para a equipe.', 'não entendi nada')).toEqual({
      needed: true,
      reason: 'bot_uncertain',
    })
  })

  it('deve priorizar [HANDOFF] do bot sobre o pedido do paciente', () => {
    expect(detectHandoffIntent('[HANDOFF]', 'quero falar com atendente').reason).toBe('bot_uncertain')
  })

  it('deve retornar false quando é uma conversa normal de agendamento', () => {
    expect(detectHandoffIntent('Tenho 08:00 e 09:00 livres.', 'quero marcar pra segunda')).toEqual({
      needed: false,
      reason: null,
    })
  })

  // Não existe regra por número de trocas de mensagem: o handoff é decidido
  // só pelo pedido explícito do paciente ou pelo marcador [HANDOFF] que o
  // próprio Claude emite (o system prompt instrui a sinalizar depois de 2
  // tentativas sem sucesso). Contar mensagens no código exigiria passar o
  // histórico para detectHandoffIntent, o que hoje não acontece.
  it('não deve transferir só porque a conversa está longa', () => {
    expect(detectHandoffIntent('Qual horário fica melhor?', 'ainda estou pensando').needed).toBe(false)
  })
})

describe('isHandoffAvailableNow — janela de atendimento humano', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Segunda-feira, 15/09/2025, 14:00 em São Paulo.
    vi.setSystemTime(new Date('2025-09-15T14:00:00-03:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve retornar true quando não há nenhuma handoff_hours cadastrada (24/7 por padrão)', async () => {
    setup({ handoff_hours: { select: [{ data: [] }, { data: null, count: 0 }] } })
    expect(await isHandoffAvailableNow('w1')).toBe(true)
  })

  it('deve retornar true quando o horário atual está dentro da janela do dia', async () => {
    setup({ handoff_hours: { select: { data: [{ start_time: '09:00', end_time: '18:00' }] } } })
    expect(await isHandoffAvailableNow('w1')).toBe(true)
  })

  it('deve retornar false quando o horário atual está fora da janela do dia', async () => {
    setup({ handoff_hours: { select: { data: [{ start_time: '08:00', end_time: '12:00' }] } } })
    expect(await isHandoffAvailableNow('w1')).toBe(false)
  })

  it('deve retornar false quando há regras para outros dias mas nenhuma para hoje', async () => {
    setup({ handoff_hours: { select: [{ data: [] }, { data: null, count: 3 }] } })
    expect(await isHandoffAvailableNow('w1')).toBe(false)
  })

  it('deve consultar as regras do dia da semana atual (segunda = 1)', async () => {
    const supabase = setup({ handoff_hours: { select: { data: [{ start_time: '09:00', end_time: '18:00' }] } } })
    await isHandoffAvailableNow('w1')

    expect(supabase.callsTo('handoff_hours', 'select')[0].filters).toContainEqual(['eq', 'day_of_week', 1])
  })

  it('deve tratar o fim da janela como exclusivo (18:00 já está fora)', async () => {
    vi.setSystemTime(new Date('2025-09-15T18:00:00-03:00'))
    setup({ handoff_hours: { select: { data: [{ start_time: '09:00', end_time: '18:00' }] } } })
    expect(await isHandoffAvailableNow('w1')).toBe(false)
  })

  it('deve aceitar o horário exato de início da janela', async () => {
    vi.setSystemTime(new Date('2025-09-15T09:00:00-03:00'))
    setup({ handoff_hours: { select: { data: [{ start_time: '09:00', end_time: '18:00' }] } } })
    expect(await isHandoffAvailableNow('w1')).toBe(true)
  })

  it('deve usar o fuso de São Paulo, não o do servidor', async () => {
    // 15/09 23:30 UTC = 20:30 em São Paulo — fora da janela 09:00–18:00.
    vi.setSystemTime(new Date('2025-09-15T23:30:00Z'))
    setup({ handoff_hours: { select: { data: [{ start_time: '09:00', end_time: '18:00' }] } } })
    expect(await isHandoffAvailableNow('w1')).toBe(false)
  })

  it('deve aceitar qualquer uma das janelas quando o dia tem mais de uma', async () => {
    setup({
      handoff_hours: {
        select: {
          data: [
            { start_time: '08:00', end_time: '12:00' },
            { start_time: '13:00', end_time: '18:00' },
          ],
        },
      },
    })
    expect(await isHandoffAvailableNow('w1')).toBe(true)
  })
})

describe('executeHandoff — transferência efetiva', () => {
  beforeEach(() => {
    sendWhatsAppMessage.mockClear()
  })

  const params = {
    workspaceId: 'w1',
    accountId: 'acc1',
    conversationId: 'c1',
    patientPhone: '5511988887777',
    handoffNumber: '+5511999998888',
    handoffMessage: 'Vou te transferir para a equipe.',
    phoneNumberId: 'pn-1',
    metaToken: 'token-decriptado',
    triggerReason: 'user_request' as const,
  }

  it('deve avisar o paciente, pausar o bot e registrar o log', async () => {
    const supabase = setup()

    await executeHandoff(params)

    const enviadas = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>).map((c) => c[0].message)
    expect(enviadas).toEqual(['Vou te transferir para a equipe.', 'Contato: +5511999998888'])

    const update = supabase.callsTo('conversations', 'update')[0]
    expect(update?.payload).toMatchObject({ status: 'handoff', bot_paused: true })
    expect(update?.filters).toContainEqual(['eq', 'id', 'c1'])

    const log = supabase.callsTo('handoff_logs', 'insert')[0]
    expect(log?.payload).toMatchObject({
      workspace_id: 'w1',
      conversation_id: 'c1',
      trigger_reason: 'user_request',
      handoff_to: '+5511999998888',
    })
  })

  it('sem número configurado: transfere do mesmo jeito, só não manda "Contato:"', async () => {
    const supabase = setup()

    await executeHandoff({ ...params, handoffNumber: null })

    const enviadas = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>).map((c) => c[0].message)
    expect(enviadas).toEqual(['Vou te transferir para a equipe.'])

    expect(supabase.callsTo('conversations', 'update')[0]?.payload).toMatchObject({ status: 'handoff', bot_paused: true })
    expect(supabase.callsTo('handoff_logs', 'insert')[0]?.payload).toMatchObject({
      trigger_reason: 'user_request',
      handoff_to: null,
    })
  })
})

describe('logHandoffUnavailable — pedido fora do horário humano', () => {
  it('deve registrar out_of_hours sem pausar o bot', async () => {
    const supabase = setup()

    await logHandoffUnavailable({
      workspaceId: 'w1',
      accountId: 'acc1',
      conversationId: 'c1',
      patientPhone: '5511988887777',
      handoffNumber: '+5511999998888',
    })

    expect(supabase.callsTo('handoff_logs', 'insert')[0].payload).toMatchObject({ trigger_reason: 'out_of_hours' })
    expect(supabase.callsTo('conversations', 'update')).toHaveLength(0)
  })
})
