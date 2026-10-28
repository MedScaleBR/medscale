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
import { resetAgentHarness, mergeSupabaseConfig, state, PARAMS, UNIT, lastSentMessage, claudeCreate } from '../helpers/agent-harness'

// Convênios e particular por unidade: Centro (w1) e Barra (w2).
const SLOT = '2025-09-15T10:00-03:00'
const APPT = { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' }
const UNIMED = '11111111-1111-4111-8111-111111111111'
const AMIL = '33333333-3333-4333-8333-333333333333'
const W1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const W2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CENTRO = { ...UNIT, id: W1, name: 'Centro' }
const BARRA = { ...UNIT, id: W2, name: 'Barra' }

function setup({ insurers, centroPrivate = true }: { insurers: unknown[]; centroPrivate?: boolean }) {
  state.units = [
    { ...CENTRO, acceptsPrivate: centroPrivate },
    { ...BARRA, acceptsPrivate: true },
  ]
  return mergeSupabaseConfig({
    health_insurers: { select: { data: insurers } },
    appointments: { select: { data: [] }, insert: { data: APPT }, update: { data: null } },
  })
}

const unimedOnlyBarra = { id: UNIMED, name: 'Unimed', health_insurer_workspaces: [{ workspace_id: W2 }] }
const amilBoth = { id: AMIL, name: 'Amil', health_insurer_workspaces: [{ workspace_id: W1 }, { workspace_id: W2 }] }

function systemPrompt(): string {
  const call = claudeCreate.mock.calls[0] as unknown as [{ system: unknown }]
  return JSON.stringify(call[0].system)
}

describe('Clara — convênios e particular por unidade', () => {
  beforeEach(() => {
    resetAgentHarness()
  })

  it('agenda com convênio aceito na unidade escolhida', async () => {
    const supabase = setup({ insurers: [unimedOnlyBarra, amilBoth] })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nUNIDADE_ID: ${W2}\nCONVENIO_ID: ${UNIMED}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')[0]?.payload).toMatchObject({
      workspace_id: W2,
      insurer_id: UNIMED,
      health_plan: 'Unimed',
    })
  })

  it('não agenda convênio que a unidade não aceita e sugere a unidade que aceita', async () => {
    const supabase = setup({ insurers: [unimedOnlyBarra, amilBoth] })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nUNIDADE_ID: ${W1}\nCONVENIO_ID: ${UNIMED}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    const msg = lastSentMessage()!
    expect(msg).toContain('A unidade Centro não atende pelo Unimed')
    expect(msg).toContain('Barra')
    expect(msg).toContain('particular na Centro')
  })

  it('não agenda particular em unidade que não atende particular', async () => {
    const supabase = setup({ insurers: [amilBoth], centroPrivate: false })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nUNIDADE_ID: ${W1}\nCONVENIO_ID: PARTICULAR`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(lastSentMessage()).toContain('A unidade Centro não atende particular')
    expect(lastSentMessage()).toContain('Amil')
  })

  it('agenda particular sem CONVENIO_ID em unidade sem convênios que atende particular', async () => {
    const supabase = setup({ insurers: [unimedOnlyBarra], centroPrivate: true })
    state.claudeResponses = [`Agendado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nUNIDADE_ID: ${W1}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(1)
  })

  it('mostra no prompt o que cada unidade aceita quando elas diferem', async () => {
    setup({ insurers: [unimedOnlyBarra, amilBoth], centroPrivate: false })

    await processIncomingMessage(PARAMS)

    const prompt = systemPrompt()
    expect(prompt).toContain('Convênios e atendimento particular variam por unidade')
    expect(prompt).toContain('Convênios aceitos: Amil. Não atende particular.')
    expect(prompt).toContain('Convênios aceitos: Unimed, Amil. Também atende particular.')
    expect(prompt).toContain(`Unimed (id: ${UNIMED}) — aceito em: Barra`)
    expect(prompt).toContain('## Convênios e particular por unidade')
  })

  it('convênio sem nenhuma unidade não aparece para a Clara', async () => {
    setup({ insurers: [{ id: UNIMED, name: 'Unimed', health_insurer_workspaces: [] }] })

    await processIncomingMessage(PARAMS)

    expect(systemPrompt()).not.toContain('Unimed')
  })
})
