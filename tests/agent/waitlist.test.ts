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

import { processIncomingMessage } from '@/lib/llm/agent'
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, UNIT_ID } from '../helpers/agent-harness'
import { filterValue } from '../helpers/supabase-mock'

const WL_ON = { accounts: { select: { data: { name: 'Clínica Teste', modules: ['waitlist'] } } } }

describe('processIncomingMessage — lista de espera', () => {
  beforeEach(() => resetAgentHarness())

  it('insere entrada bot quando LISTA_ESPERA vem com horário e a unidade é única', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: null }, insert: { data: { id: 'wl1' } }, update: { data: null } },
    })
    state.claudeResponses = ['Beleza, te aviso!\nLISTA_ESPERA: 2026-09-16T15:00-03:00']

    await processIncomingMessage(PARAMS)

    const insert = supabase.callsTo('waitlist', 'insert')[0]
    expect(insert?.payload).toMatchObject({
      workspace_id: UNIT_ID,
      account_id: PARAMS.accountId,
      patient_id: 'p1',
      patient_phone: PARAMS.patientPhone,
      desired_date: '2026-09-16',
      desired_time: '15:00',
      source: 'bot',
      status: 'waiting',
    })
  })

  it('grava desired_time null quando o paciente deu só o dia', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: null }, insert: { data: { id: 'wl1' } }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')[0].payload).toMatchObject({ desired_date: '2026-09-16', desired_time: null })
  })

  it('atualiza a entrada existente em vez de criar outra (de-dupe)', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      waitlist: { select: { data: { id: 'wl-existente' } }, insert: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16T16:00-03:00']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')).toHaveLength(0)
    const update = supabase.callsTo('waitlist', 'update')[0]
    expect(update?.payload).toMatchObject({ desired_time: '16:00' })
    expect(filterValue(update!, 'eq', 'id')).toBe('wl-existente')
  })

  it('não toca em waitlist quando o módulo está desligado', async () => {
    const supabase = mergeSupabaseConfig({
      waitlist: { select: { data: null }, insert: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Te aviso!\nLISTA_ESPERA: 2026-09-16']

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('waitlist', 'insert')).toHaveLength(0)
    expect(supabase.callsTo('waitlist', 'update')).toHaveLength(0)
  })

  it('fecha entradas waiting do paciente quando ele agenda', async () => {
    const supabase = mergeSupabaseConfig({
      ...WL_ON,
      appointments: {
        select: { data: [] },
        insert: { data: { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' } },
        update: { data: null },
      },
      waitlist: { select: { data: null }, update: { data: null } },
    })
    state.claudeResponses = ['Confirmado!\nAGENDAMENTO_CONFIRMADO: 2025-09-15T10:00-03:00']

    await processIncomingMessage(PARAMS)

    const update = supabase.callsTo('waitlist', 'update').find((c) => (c.payload as { status?: string }).status === 'scheduled')
    expect(update).toBeDefined()
    expect(filterValue(update!, 'eq', 'patient_id')).toBe('p1')
    expect(filterValue(update!, 'eq', 'workspace_id')).toBe(UNIT_ID)
  })
})
