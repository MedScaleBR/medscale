import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseMarkers } from '@/lib/bot/parse-markers'

// As factories abaixo usam `await import()` porque vi.mock é hoisted acima
// dos imports estáticos — referenciar um binding importado direto daria TDZ.
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('../helpers/agent-harness')
  return { createAdminClient: () => h.state.supabase.client, createClient: async () => h.state.supabase.client }
})
vi.mock('@/lib/bot/config', async () => {
  const h = await import('../helpers/agent-harness')
  return { getBotConfig: async () => h.state.botConfig, invalidateBotConfigCache: () => {} }
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

import { processIncomingMessage } from '@/lib/llm/agent'
import {
  resetAgentHarness,
  mergeSupabaseConfig,
  state,
  PARAMS,
  PATIENT,
  lastSentMessage,
  sentMessages,
} from '../helpers/agent-harness'

const SLOT = '2025-09-15T10:00-03:00'
const APPT_UUID = '3f7c1a90-2b4d-4c1e-9f80-1234567890ab'

describe('parseMarkers — parsing puro dos marcadores de controle', () => {
  it('deve extrair o horário quando AGENDAMENTO_CONFIRMADO está no formato correto', () => {
    const parsed = parseMarkers(`Perfeito! Confirmado.\nAGENDAMENTO_CONFIRMADO: ${SLOT}`)
    expect(parsed.confirmedSlot).toBe(SLOT)
    expect(parsed.confirmedDate?.toISOString()).toBe('2025-09-15T13:00:00.000Z')
  })

  it('deve remover a linha do marcador da mensagem enviada ao paciente', () => {
    const parsed = parseMarkers(`Confirmado para segunda!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`)
    expect(parsed.messageForPatient).toBe('Confirmado para segunda!')
    expect(parsed.messageForPatient).not.toContain('AGENDAMENTO_CONFIRMADO')
  })

  it('deve aceitar o marcador com espaço extra depois dos dois pontos', () => {
    // O parser usa \s* — variação de espaçamento não quebra o agendamento.
    const parsed = parseMarkers(`Fechado.\nAGENDAMENTO_CONFIRMADO:  ${SLOT}`)
    expect(parsed.confirmedSlot).toBe(SLOT)
    expect(parsed.messageForPatient).toBe('Fechado.')
  })

  it('deve aceitar o marcador com segundos no horário', () => {
    const parsed = parseMarkers('AGENDAMENTO_CONFIRMADO: 2025-09-15T10:00:00-03:00')
    expect(parsed.confirmedSlot).toBe('2025-09-15T10:00:00-03:00')
  })

  it('deve ignorar horário sem o offset -03:00 (formato inválido)', () => {
    const parsed = parseMarkers('AGENDAMENTO_CONFIRMADO: 2025-09-15T10:00')
    expect(parsed.confirmedSlot).toBeNull()
    expect(parsed.confirmedDate).toBeNull()
  })

  it('deve extrair o id da consulta quando CANCELAMENTO_CONFIRMADO traz um UUID', () => {
    const parsed = parseMarkers(`Cancelado.\nCANCELAMENTO_CONFIRMADO: ${APPT_UUID}`)
    expect(parsed.cancelledAppointmentId).toBe(APPT_UUID)
    expect(parsed.messageForPatient).toBe('Cancelado.')
  })

  it('deve ignorar CANCELAMENTO_CONFIRMADO com horário no lugar do id', () => {
    // O modelo às vezes reconstrói um horário — sem UUID não há o que cancelar.
    const parsed = parseMarkers('CANCELAMENTO_CONFIRMADO: 2025-09-15T10:00-03:00')
    expect(parsed.cancelledAppointmentId).toBeNull()
  })

  it('deve extrair PROCEDIMENTO_ID quando traz um UUID e removê-lo da mensagem do paciente', () => {
    const parsed = parseMarkers(
      `Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nPROCEDIMENTO_ID: ${APPT_UUID}`
    )
    expect(parsed.procedureId).toBe(APPT_UUID)
    expect(parsed.messageForPatient).toBe('Confirmado!')
    expect(parsed.messageForPatient).not.toContain('PROCEDIMENTO_ID')
  })

  it('deve devolver procedureId nulo quando não há a linha PROCEDIMENTO_ID', () => {
    const parsed = parseMarkers(`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`)
    expect(parsed.procedureId).toBeNull()
  })

  it('deve extrair NOME_PACIENTE em qualquer posição da resposta', () => {
    const noMeio = parseMarkers('Oi!\nNOME_PACIENTE: João Silva\nComo posso ajudar?')
    expect(noMeio.patientName).toBe('João Silva')
    const noFim = parseMarkers('Prazer, João!\nNOME_PACIENTE: João Silva')
    expect(noFim.patientName).toBe('João Silva')
    expect(noFim.messageForPatient).toBe('Prazer, João!')
  })

  it('deve reconhecer [HANDOFF] e mantê-lo no cleanedMessage mas não na mensagem do paciente', () => {
    const parsed = parseMarkers('[HANDOFF] Vou te passar para a equipe.')
    expect(parsed.handoffRequested).toBe(true)
    expect(parsed.cleanedMessage).toContain('[HANDOFF]')
    expect(parsed.messageForPatient).toBe('Vou te passar para a equipe.')
  })

  it('deve extrair os três marcadores juntos numa remarcação', () => {
    const parsed = parseMarkers(
      `Remarcado!\nCANCELAMENTO_CONFIRMADO: ${APPT_UUID}\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nNOME_PACIENTE: Maria Oliveira`
    )
    expect(parsed.cancelledAppointmentId).toBe(APPT_UUID)
    expect(parsed.confirmedSlot).toBe(SLOT)
    expect(parsed.patientName).toBe('Maria Oliveira')
    expect(parsed.messageForPatient.replace(/\s+/g, ' ').trim()).toBe('Remarcado!')
  })

  it('deve devolver tudo nulo quando a resposta não tem nenhum marcador', () => {
    const parsed = parseMarkers('Claro! Qual dia fica melhor pra você?')
    expect(parsed.confirmedSlot).toBeNull()
    expect(parsed.cancelledAppointmentId).toBeNull()
    expect(parsed.patientName).toBeNull()
    expect(parsed.handoffRequested).toBe(false)
    expect(parsed.messageForPatient).toBe('Claro! Qual dia fica melhor pra você?')
  })
})

describe('processIncomingMessage — ações disparadas pelos marcadores', () => {
  beforeEach(() => {
    resetAgentHarness()
  })

  it('deve criar a consulta e não enviar o marcador ao paciente quando AGENDAMENTO_CONFIRMADO vem no formato correto', async () => {
    const supabase = mergeSupabaseConfig({
      appointments: {
        select: { data: [] },
        insert: { data: { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' } },
      },
    })
    state.claudeResponses = [`Prontinho, confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    const insert = supabase.callsTo('appointments', 'insert')[0]
    expect(insert).toBeDefined()
    expect(insert.payload).toMatchObject({
      workspace_id: 'w1',
      source: 'bot',
      status: 'agendado',
      scheduled_at: '2025-09-15T13:00:00.000Z',
    })
    expect(lastSentMessage()).toBe('Prontinho, confirmado!')
    expect(lastSentMessage()).not.toContain('AGENDAMENTO_CONFIRMADO')
  })

  it('deve avisar que o horário ficou indisponível e não criar consulta quando o slot é revalidado como ocupado', async () => {
    const supabase = mergeSupabaseConfig({})
    state.slotAvailable = false
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('acabou de ficar indisponível')
  })

  it('deve atualizar o nome do paciente quando NOME_PACIENTE aparece na resposta', async () => {
    const supabase = mergeSupabaseConfig({})
    state.claudeResponses = ['Prazer, Maria!\nNOME_PACIENTE: Maria Oliveira']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('patients', 'update')[0]
    expect(update?.payload).toEqual({ full_name: 'Maria Oliveira' })
    expect(update?.filters).toContainEqual(['eq', 'id', PATIENT.id])
    expect(lastSentMessage()).toBe('Prazer, Maria!')
  })

  it('não deve atualizar o nome quando o valor é igual ao que já está salvo', async () => {
    const supabase = mergeSupabaseConfig({
      patients: { select: { data: { id: 'p1', full_name: 'Maria Oliveira' } } },
    })
    state.claudeResponses = ['Oi de novo, Maria!\nNOME_PACIENTE: Maria Oliveira']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('patients', 'update')).toHaveLength(0)
  })

  it('deve cancelar a consulta quando CANCELAMENTO_CONFIRMADO casa com uma consulta real', async () => {
    const supabase = mergeSupabaseConfig({
      appointments: {
        select: [
          { data: [{ id: APPT_UUID, scheduled_at: '2025-09-20T13:00:00.000Z' }] }, // consultas futuras
          { data: { id: APPT_UUID, gcal_event_id: null } }, // busca do cancelamento
        ],
        update: { data: null },
      },
    })
    state.claudeResponses = [`Cancelado, então.\nCANCELAMENTO_CONFIRMADO: ${APPT_UUID}`]

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('appointments', 'update')[0]
    expect(update?.payload).toEqual({ status: 'cancelado' })
    expect(lastSentMessage()).toBe('Cancelado, então.')
  })

  it('deve substituir a resposta por uma correção honesta quando o cancelamento não encontra a consulta', async () => {
    mergeSupabaseConfig({
      appointments: { select: [{ data: [] }, { data: null }], update: { data: null } },
    })
    state.claudeResponses = [`Pronto, cancelei sua consulta!\nCANCELAMENTO_CONFIRMADO: ${APPT_UUID}`]

    await processIncomingMessage(PARAMS)

    expect(lastSentMessage()).toContain('Não encontrei essa consulta no sistema')
    expect(sentMessages()).not.toContain('Pronto, cancelei sua consulta!')
  })

  it('não deve causar nenhum efeito colateral quando a resposta não tem marcador', async () => {
    const supabase = mergeSupabaseConfig({})
    state.claudeResponses = ['Claro! Qual dia fica melhor pra você?']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
    expect(supabase.callsTo('patients', 'update')).toHaveLength(0)
    expect(supabase.callsTo('handoff_logs', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toBe('Claro! Qual dia fica melhor pra você?')
    const saved = supabase.callsTo('messages', 'insert').at(-1)
    expect(saved?.payload).toMatchObject({ role: 'assistant', content: 'Claro! Qual dia fica melhor pra você?' })
  })
})
