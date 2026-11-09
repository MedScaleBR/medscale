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
  return { getFreeSlotsForBot: h.getFreeSlotsForBot, getFreeSlotsByDayForBot: h.getFreeSlotsByDayForBot, isSlotAvailable: h.isSlotAvailable }
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
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, lastSentMessage } from '../helpers/agent-harness'
import { bookingNotOpenMessage } from '@/lib/bot/working-days'

// 15/09/2025 é segunda.
const SLOT = '2025-09-15T10:00-03:00'
const APPT = { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' }
const WL_ON = { accounts: { select: { data: { name: 'Clínica Teste', modules: ['waitlist'] } } } }
const WAITLIST = { waitlist: { select: { data: null }, insert: { data: { id: 'wl1' } }, update: { data: null } } }

describe('processIncomingMessage — agenda aberta até e dias bloqueados', () => {
  beforeEach(() => resetAgentHarness())

  it('não marca depois da agenda aberta e avisa até quando está aberta', async () => {
    state.units = [{ ...state.units[0], bookingOpenUntil: '2025-09-14' }]
    const supabase = mergeSupabaseConfig({ appointments: { select: { data: [] }, insert: { data: APPT } } })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toBe(bookingNotOpenMessage('Clínica Teste', '2025-09-14', false))
    expect(lastSentMessage()).toContain('aberta até 14/09')
  })

  it('marca normalmente no último dia da agenda aberta', async () => {
    state.units = [{ ...state.units[0], bookingOpenUntil: '2025-09-15' }]
    const supabase = mergeSupabaseConfig({ appointments: { select: { data: [] }, insert: { data: APPT } } })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
    expect(lastSentMessage()).toBe('Confirmado!')
  })

  it('não marca num dia bloqueado, mesmo dentro da agenda aberta', async () => {
    state.units = [{ ...state.units[0], workingDays: [1, 2], blockedDates: ['2025-09-15'], bookingOpenUntil: '2025-12-31' }]
    const supabase = mergeSupabaseConfig({ appointments: { select: { data: [] }, insert: { data: APPT } } })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Em 15/09 não haverá atendimento na unidade Clínica Teste.')
  })

  it('aceita lista de espera para uma data depois da agenda aberta (avisa quando abrir)', async () => {
    state.units = [{ ...state.units[0], bookingOpenUntil: '2025-09-14' }]
    const supabase = mergeSupabaseConfig({ ...WL_ON, ...WAITLIST })
    state.claudeResponses = ['Te aviso quando abrir!\nLISTA_ESPERA: 2025-09-15']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')[0]?.payload).toMatchObject({ desired_date: '2025-09-15' })
  })

  it('não põe na lista de espera um dia bloqueado', async () => {
    state.units = [{ ...state.units[0], blockedDates: ['2025-09-15'] }]
    const supabase = mergeSupabaseConfig({ ...WL_ON, ...WAITLIST })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2025-09-15']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('Em 15/09 não haverá atendimento')
  })
})
