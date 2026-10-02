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
vi.mock('@/lib/realtime/broadcast', () => ({ broadcastToWorkspace: vi.fn(), workspaceChannel: (id: string) => `handoff-toast:${id}` }))

import { processIncomingMessage } from '@/lib/llm/agent'
import {
  resetAgentHarness,
  mergeSupabaseConfig,
  state,
  createEvent,
  cancelEvent,
  isSlotAvailable,
  sendWhatsAppMessage,
  PARAMS,
  UNIT_ID,
  lastSentMessage,
} from '../helpers/agent-harness'
import { filterValue } from '../helpers/supabase-mock'

const SLOT = '2025-09-15T10:00-03:00'
const SLOT_ISO = '2025-09-15T13:00:00.000Z'
const APPT = { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' }
const INSURER_ID = '11111111-1111-4111-8111-111111111111'
const PROCEDURE_ID = '22222222-2222-4222-8222-222222222222'

function withAppointmentInsert() {
  return mergeSupabaseConfig({
    appointments: { select: { data: [] }, insert: { data: APPT }, update: { data: null } },
  })
}

describe('processIncomingMessage — agendamento pelo bot', () => {
  beforeEach(() => {
    resetAgentHarness()
  })

  it.each([{ modules: [] }, { modules: ['billing'] }])('vincula o convênio ativo e não cria receita particular, módulos $modules', async ({ modules }) => {
    const supabase = mergeSupabaseConfig({
      accounts: { select: { data: { name: 'Clínica Teste', modules: [...modules, 'revenue_cycle'] } } },
      health_insurers: { select: { data: [{ id: INSURER_ID, name: 'Unimed' }] } },
      procedure_catalog: { select: { data: [{ id: PROCEDURE_ID, name: 'Consulta', default_price: 300, workspace_id: UNIT_ID }] } },
      appointments: { select: { data: [] }, insert: { data: APPT } },
    })
    state.claudeResponses = [`Confirmado pela Unimed!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: ${INSURER_ID}\nPROCEDIMENTO_ID: ${PROCEDURE_ID}`]

    await processIncomingMessage({ ...PARAMS, message: 'Quero agendar pela Unimed' })

    expect(supabase.callsTo('appointments', 'insert')[0]?.payload).toMatchObject({
      billing_type: 'convenio', insurer_id: INSURER_ID, health_plan: 'Unimed', price: null,
    })
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toBe('Confirmado pela Unimed!')
    const insurersQuery = supabase.callsTo('health_insurers', 'select')[0]
    expect(filterValue(insurersQuery, 'eq', 'account_id')).toBe(PARAMS.accountId)
    expect(filterValue(insurersQuery, 'eq', 'is_active')).toBe(true)
  })

  it('pede esclarecimento sem agendar como particular quando o convênio não é ativo desta conta', async () => {
    const supabase = withAppointmentInsert()
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: ${INSURER_ID}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('convênio')
    expect(lastSentMessage()).not.toContain('Confirmado!')
  })

  it('não assume particular se a Clara omite a escolha numa clínica com convênios', async () => {
    const supabase = mergeSupabaseConfig({
      health_insurers: { select: { data: [{ id: INSURER_ID, name: 'Unimed' }] } },
      appointments: { select: { data: [] }, insert: { data: APPT } },
    })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]
    await processIncomingMessage(PARAMS)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('convênio')
  })

  it('não assume particular quando a consulta dos convênios falha', async () => {
    const supabase = mergeSupabaseConfig({
      health_insurers: { select: { data: null, error: { message: 'Indisponível' } } },
      appointments: { select: { data: [] }, insert: { data: APPT } },
    })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]
    await processIncomingMessage(PARAMS)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('convênio')
  })

  it('não permite particular quando a clínica atende somente convênio', async () => {
    const supabase = withAppointmentInsert()
    state.botConfig!.acceptsPrivate = false
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: PARTICULAR`]
    await processIncomingMessage(PARAMS)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).not.toContain('prefere atendimento particular')
  })

  it('preserva a consulta antiga se a remarcação depende de esclarecer o convênio', async () => {
    const supabase = mergeSupabaseConfig({
      appointments: { select: [
        { data: [{ id: PROCEDURE_ID, workspace_id: UNIT_ID, scheduled_at: '2025-09-20T13:00:00.000Z' }] },
        { data: { id: PROCEDURE_ID, workspace_id: UNIT_ID } },
      ], insert: { data: APPT } },
    })
    state.claudeResponses = [`Remarcado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: ${INSURER_ID}\nCANCELAMENTO_CONFIRMADO: ${PROCEDURE_ID}`]
    await processIncomingMessage(PARAMS)
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('respeita a escolha explícita por particular mesmo havendo convênio no histórico', async () => {
    const supabase = mergeSupabaseConfig({
      accounts: { select: { data: { name: 'Clínica Teste', modules: ['revenue_cycle'] } } },
      health_insurers: { select: { data: [{ id: INSURER_ID, name: 'Unimed' }] } },
      procedure_catalog: { select: { data: [{ id: PROCEDURE_ID, name: 'Consulta', default_price: 300, workspace_id: UNIT_ID }] } },
      appointments: { select: { data: [] }, insert: { data: APPT } },
      messages: { insert: { data: null }, select: { data: [
        { role: 'user', content: 'Prefiro particular' },
        { role: 'assistant', content: 'Você tem algum convênio?' },
        { role: 'user', content: 'Tenho Unimed' },
      ] } },
    })
    state.claudeResponses = [`Confirmado particular!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: PARTICULAR\nPROCEDIMENTO_ID: ${PROCEDURE_ID}`]

    await processIncomingMessage({ ...PARAMS, message: 'Prefiro particular' })

    const payload = supabase.callsTo('appointments', 'insert')[0]?.payload
    expect(payload).not.toHaveProperty('insurer_id', INSURER_ID)
    expect(payload).toHaveProperty('price', 300)
    expect(supabase.callsTo('revenue_entries', 'insert')).toHaveLength(1)
    expect(lastSentMessage()).toBe('Confirmado particular!')
  })

  it('deve criar a consulta com source "bot" quando o slot está disponível na revalidação', async () => {
    const supabase = withAppointmentInsert()
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(isSlotAvailable).toHaveBeenCalledWith(UNIT_ID, new Date(SLOT), 30)
    const insert = supabase.callsTo('appointments', 'insert')[0]
    expect(insert?.payload).toEqual({
      workspace_id: UNIT_ID,
      account_id: PARAMS.accountId,
      patient_id: 'p1',
      patient_name: 'Paciente',
      patient_phone: PARAMS.patientPhone,
      scheduled_at: SLOT_ISO,
      duration_min: 30,
      source: 'bot',
      status: 'agendado',
      // Ciclo de receita: sem catálogo de procedimentos e sem preço-base
      // configurado, os snapshots entram nulos e nenhum revenue_entry é criado.
      procedure_id: null,
      procedure_name: null,
      price: null,
    })
  })

  it('deve associar a consulta criada à conversa correta', async () => {
    const supabase = withAppointmentInsert()
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    const update = supabase
      .callsTo('conversations', 'update')
      .find((c) => (c.payload as { appointment_id?: string }).appointment_id !== undefined)
    // A conversa passa a apontar para a consulta E fixa a unidade escolhida.
    expect(update?.payload).toEqual({ appointment_id: 'appt-1', workspace_id: UNIT_ID })
    expect(filterValue(update!, 'eq', 'id')).toBe('c1')
  })

  it('deve usar o nome real do paciente capturado na mesma resposta', async () => {
    const supabase = mergeSupabaseConfig({
      patients: { select: { data: { id: 'p1', full_name: 'Paciente' } }, update: { data: null } },
      appointments: { select: { data: [] }, insert: { data: APPT }, update: { data: null } },
    })
    state.claudeResponses = [`Confirmado, Maria!\nNOME_PACIENTE: Maria Oliveira\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')[0].payload).toMatchObject({ patient_name: 'Maria Oliveira' })
  })

  it('não deve criar consulta e deve sinalizar falha quando o slot foi ocupado entre a oferta e a confirmação', async () => {
    const supabase = withAppointmentInsert()
    state.slotAvailable = false
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(createEvent).not.toHaveBeenCalled()
    expect(lastSentMessage()).toContain('acabou de ficar indisponível')
    // A mensagem de correção é o que fica salvo — nunca a confirmação falsa.
    const saved = supabase.callsTo('messages', 'insert').at(-1)
    expect((saved?.payload as { content: string }).content).toContain('acabou de ficar indisponível')
  })

  it('deve avisar falha quando o insert do appointment não retorna linha', async () => {
    mergeSupabaseConfig({
      appointments: { select: { data: [] }, insert: { data: null }, update: { data: null } },
    })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(lastSentMessage()).toContain('acabou de ficar indisponível')
  })

  it('deve criar o evento no Google Calendar e salvar o gcal_event_id quando o calendário está conectado', async () => {
    const supabase = withAppointmentInsert()
    state.googleConnected = true
    state.googleEmail = 'medico@clinica.com'
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: UNIT_ID,
        patientName: 'Paciente',
        startTime: new Date(SLOT),
        durationMin: 30,
        doctorEmail: 'medico@clinica.com',
      })
    )
    const update = supabase
      .callsTo('appointments', 'update')
      .find((c) => (c.payload as { gcal_event_id?: string }).gcal_event_id !== undefined)
    expect(update?.payload).toEqual({ gcal_event_id: 'gcal-event-1' })
  })

  it('não deve cancelar a consulta no Supabase quando a criação do evento no Google falha', async () => {
    const supabase = withAppointmentInsert()
    state.googleConnected = true
    state.googleEmail = 'medico@clinica.com'
    state.createEventError = new Error('Google Calendar fora do ar')
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
    expect(lastSentMessage()).toBe('Confirmado!')
    const gcalUpdate = supabase
      .callsTo('appointments', 'update')
      .find((c) => (c.payload as { gcal_event_id?: string }).gcal_event_id !== undefined)
    expect(gcalUpdate).toBeUndefined()
  })

  it('deve agendar normalmente sem tentar sincronizar quando o Google não está conectado', async () => {
    const supabase = withAppointmentInsert()
    state.googleConnected = false
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(createEvent).not.toHaveBeenCalled()
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
    expect(lastSentMessage()).toBe('Confirmado!')
  })

  it('deve tratar o slot como disponível quando a revalidação em si falha', async () => {
    // Falha do Google não pode impedir o paciente de agendar — o catch da
    // revalidação assume disponível de propósito.
    const supabase = withAppointmentInsert()
    isSlotAvailable.mockRejectedValueOnce(new Error('Google fora do ar'))
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
  })

  it('deve cancelar o evento no Google quando a consulta cancelada tinha gcal_event_id', async () => {
    const APPT_UUID = '3f7c1a90-2b4d-4c1e-9f80-1234567890ab'
    mergeSupabaseConfig({
      appointments: {
        select: [
          { data: [{ id: APPT_UUID, scheduled_at: '2025-09-20T13:00:00.000Z' }] },
          { data: { id: APPT_UUID, gcal_event_id: 'gcal-9', workspace_id: 'w1' } },
        ],
        update: { data: null },
      },
    })
    state.claudeResponses = [`Cancelado.\nCANCELAMENTO_CONFIRMADO: ${APPT_UUID}`]

    await processIncomingMessage(PARAMS)

    expect(cancelEvent).toHaveBeenCalledWith(UNIT_ID, 'gcal-9')
  })
})

describe('processIncomingMessage — handoff dentro do fluxo completo', () => {
  beforeEach(() => {
    resetAgentHarness()
  })

  it('deve transferir de verdade quando o handoff está disponível agora', async () => {
    const supabase = mergeSupabaseConfig({
      handoff_hours: { select: { data: [] } },
      handoff_logs: { insert: { data: null } },
    })
    state.claudeResponses = ['[HANDOFF] Vou te passar para a equipe.']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('conversations', 'update').at(-1)
    expect(update?.payload).toMatchObject({ status: 'handoff', bot_paused: true })
    expect(supabase.callsTo('handoff_logs', 'insert')[0].payload).toMatchObject({ trigger_reason: 'bot_uncertain' })
    const enviadas = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>).map((c) => c[0].message)
    expect(enviadas).toContain('Contato: +5511999998888')
  })

  it('deve manter o bot ativo e registrar out_of_hours quando o handoff está fora do horário', async () => {
    const supabase = mergeSupabaseConfig({
      // Nenhuma regra para hoje, mas existem regras para outros dias.
      handoff_hours: { select: [{ data: [] }, { data: null, count: 2 }] },
      handoff_logs: { insert: { data: null } },
    })
    state.claudeResponses = ['[HANDOFF] Vou te passar para a equipe.']

    await processIncomingMessage(PARAMS)

    const pausas = supabase
      .callsTo('conversations', 'update')
      .filter((c) => (c.payload as { bot_paused?: boolean }).bot_paused === true)
    expect(pausas).toHaveLength(0)
    expect(supabase.callsTo('handoff_logs', 'insert')[0].payload).toMatchObject({ trigger_reason: 'out_of_hours' })
    expect(lastSentMessage()).toContain('Nossa equipe responde no próximo horário comercial')
  })

  it('não deve enviar o marcador [HANDOFF] ao paciente', async () => {
    mergeSupabaseConfig({ handoff_hours: { select: { data: [] } }, handoff_logs: { insert: { data: null } } })
    state.claudeResponses = ['[HANDOFF] Vou te passar para a equipe.']

    await processIncomingMessage(PARAMS)

    const enviadas = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>).map((c) => c[0].message)
    expect(enviadas.join('\n')).not.toContain('[HANDOFF]')
  })
})
