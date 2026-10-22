import { describe, it, expect, beforeEach, vi } from 'vitest'

const requestExternalConfirmation = vi.hoisted(() => vi.fn())
const notifyOutsourcedIssue = vi.hoisted(() => vi.fn(async () => undefined))

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
  return { createEvent: h.createEvent, cancelEvent: h.cancelEvent, deleteEvent: h.deleteEvent }
})
vi.mock('@anthropic-ai/sdk', async () => {
  const h = await import('../helpers/agent-harness')
  return { default: class { messages = { create: h.claudeCreate } } }
})
vi.mock('@/lib/realtime/broadcast', () => ({ broadcastToWorkspace: vi.fn(), workspaceChannel: (id: string) => `handoff-toast:${id}` }))
vi.mock('@/lib/outsourced/request', () => ({ requestExternalConfirmation }))
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue }))

import { processIncomingMessage } from '@/lib/llm/agent'
import {
  resetAgentHarness,
  mergeSupabaseConfig,
  state,
  UNIT,
  isSlotAvailable,
  sendWhatsAppMessage,
  cancelEvent,
  deleteEvent,
  PARAMS,
  lastSentMessage,
} from '../helpers/agent-harness'
import {
  alreadyPendingMessage,
  missingDataMessage,
  REQUEST_FAILED_MESSAGE,
  requestedMessage,
} from '@/lib/outsourced/messages'

const SLOT = '2026-10-16T08:00-03:00'
const CLINIC_PHONE = '5571999990000'
const OLD_APPT = '3f7c1a90-2b4d-4c1e-9f80-1234567890ab'
const APPT = { id: 'appt-1', patient_name: 'Paciente', patient_phone: PARAMS.patientPhone, type: 'consulta' }
const COMPLETE_PATIENT = { id: 'p1', full_name: 'Maria Souza', birth_date: '1980-05-03' }
const CLAUDE_OK = `Consulta confirmada!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: PARTICULAR`
const BOOKING_FAILED = 'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro horário entre os que te passei, por favor?'

function outsourced() {
  state.units = [{ ...UNIT, isOutsourced: true, externalClinicPhone: CLINIC_PHONE, name: 'IAD Pituba' }]
}

function completePatient() {
  return mergeSupabaseConfig({
    patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
    appointments: { select: { data: [] }, insert: { data: APPT }, update: { data: null } },
  })
}

function savedAssistantMessages(supabase: ReturnType<typeof mergeSupabaseConfig>): string[] {
  return supabase
    .callsTo('messages', 'insert')
    .map((c) => c.payload as { role: string; content: string })
    .filter((p) => p.role === 'assistant')
    .map((p) => p.content)
}

describe('processIncomingMessage — agendamento em unidade terceirizada', () => {
  beforeEach(() => {
    resetAgentHarness()
    requestExternalConfirmation.mockReset().mockResolvedValue({ kind: 'requested', appointmentId: 'ext-1' })
  })

  it('unidade nativa continua agendando direto, sem pedir à clínica parceira', async () => {
    const supabase = mergeSupabaseConfig({ appointments: { select: { data: [] }, insert: { data: APPT }, update: { data: null } } })
    state.claudeResponses = [`Confirmado!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')[0]?.payload).toMatchObject({ status: 'agendado' })
    expect(requestExternalConfirmation).not.toHaveBeenCalled()
    expect(lastSentMessage()).toBe('Confirmado!')
  })

  it('sem nome real e nascimento: não agenda e pede os dados', async () => {
    outsourced()
    const supabase = mergeSupabaseConfig({ appointments: { select: { data: [] }, insert: { data: APPT } } })
    state.claudeResponses = [CLAUDE_OK]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(requestExternalConfirmation).not.toHaveBeenCalled()
    expect(isSlotAvailable).not.toHaveBeenCalled()
    expect(lastSentMessage()).toBe(missingDataMessage(['nome', 'nascimento'], 'IAD Pituba'))
    expect(savedAssistantMessages(supabase)).not.toContain('Consulta confirmada!')
  })

  it('sem escolha de convênio numa clínica sem convênios que aceita particular: pergunta o convênio', async () => {
    outsourced()
    const supabase = completePatient()
    state.claudeResponses = [`Consulta confirmada!\nAGENDAMENTO_CONFIRMADO: ${SLOT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(requestExternalConfirmation).not.toHaveBeenCalled()
    expect(lastSentMessage()).toBe(missingDataMessage(['convenio'], 'IAD Pituba'))
  })

  it('dados completos: pede à clínica parceira e manda a mensagem fixa no lugar da do Claude', async () => {
    outsourced()
    const supabase = completePatient()
    state.claudeResponses = [CLAUDE_OK]

    await processIncomingMessage(PARAMS)

    expect(isSlotAvailable).toHaveBeenCalledWith('w1', new Date(SLOT), 30)
    expect(requestExternalConfirmation).toHaveBeenCalledTimes(1)
    expect(requestExternalConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: PARAMS.accountId,
        accountName: 'Clínica Teste',
        unit: { id: 'w1', name: 'IAD Pituba', externalClinicPhone: CLINIC_PHONE },
        patient: { id: 'p1', fullName: 'Maria Souza', birthDate: '1980-05-03' },
        patientPhone: PARAMS.patientPhone,
        conversationId: 'c1',
        scheduledAt: new Date(SLOT),
        durationMin: 30,
        insurer: null,
        procedure: null,
        replacingAppointmentId: null,
        phoneNumberId: 'pn-1',
        metaToken: 'decrypted:encrypted-token',
      })
    )
    // Nenhum agendamento nativo em paralelo.
    expect(supabase.callsTo('appointments', 'insert')).toHaveLength(0)

    const expected = requestedMessage({ scheduledAt: new Date(SLOT), unitName: 'IAD Pituba' })
    expect(lastSentMessage()).toBe(expected)
    expect(sendWhatsAppMessage.mock.calls.map((c) => (c as unknown as [{ message: string }])[0].message)).not.toContain('Consulta confirmada!')
    expect(savedAssistantMessages(supabase)).toEqual([expected])
  })

  it('passa o convênio escolhido para a solicitação', async () => {
    outsourced()
    const INSURER_ID = '11111111-1111-4111-8111-111111111111'
    mergeSupabaseConfig({
      patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
      health_insurers: { select: { data: [{ id: INSURER_ID, name: 'Unimed' }] } },
    })
    state.claudeResponses = [`Consulta confirmada!\nAGENDAMENTO_CONFIRMADO: ${SLOT}\nCONVENIO_ID: ${INSURER_ID}`]

    await processIncomingMessage(PARAMS)

    expect(requestExternalConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ insurer: { id: INSURER_ID, name: 'Unimed' }, procedure: null })
    )
  })

  it.each([
    [{ kind: 'already_pending' }, alreadyPendingMessage('IAD Pituba')],
    [{ kind: 'send_failed', appointmentId: 'ext-1' }, REQUEST_FAILED_MESSAGE],
    [{ kind: 'insert_failed' }, REQUEST_FAILED_MESSAGE],
  ])('resultado %o vira a mensagem fixa correspondente', async (result, message) => {
    outsourced()
    completePatient()
    requestExternalConfirmation.mockResolvedValueOnce(result)
    state.claudeResponses = [CLAUDE_OK]

    await processIncomingMessage(PARAMS)

    expect(lastSentMessage()).toBe(message)
  })

  it('slot ocupado na revalidação: mensagem de indisponível e nada pedido à clínica', async () => {
    outsourced()
    completePatient()
    state.slotAvailable = false
    state.claudeResponses = [CLAUDE_OK]

    await processIncomingMessage(PARAMS)

    expect(requestExternalConfirmation).not.toHaveBeenCalled()
    expect(lastSentMessage()).toBe(BOOKING_FAILED)
  })

  it('remarcação na mesma resposta: a consulta cancelada é ignorada na checagem de duplicidade', async () => {
    outsourced()
    mergeSupabaseConfig({
      patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: null, workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    state.claudeResponses = [`${CLAUDE_OK}\nCANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    expect(requestExternalConfirmation).toHaveBeenCalledWith(expect.objectContaining({ replacingAppointmentId: OLD_APPT }))
  })

  it('sem dados completos numa remarcação: preserva a consulta antiga', async () => {
    outsourced()
    const supabase = mergeSupabaseConfig({
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: null, workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    state.claudeResponses = [`${CLAUDE_OK}\nCANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
    expect(lastSentMessage()).toBe(missingDataMessage(['nome', 'nascimento'], 'IAD Pituba'))
  })

  it.each([
    { kind: 'already_pending' },
    { kind: 'send_failed', appointmentId: 'ext-1' },
    { kind: 'insert_failed' },
  ])('remarcação sem pedido feito ($kind): preserva a consulta antiga', async (result) => {
    outsourced()
    const supabase = mergeSupabaseConfig({
      patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: null, workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    requestExternalConfirmation.mockResolvedValueOnce(result)
    state.claudeResponses = [`${CLAUDE_OK}
CANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })

  it('remarcação com pedido feito cancela a consulta antiga', async () => {
    outsourced()
    const supabase = mergeSupabaseConfig({
      patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: null, workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    state.claudeResponses = [`${CLAUDE_OK}
CANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    const cancel = supabase.callsTo('appointments', 'update').find((c) => (c.payload as { status?: string }).status === 'cancelado')
    expect(cancel).toBeDefined()
  })

  it('cancelamento simples (sem agendamento) em unidade terceirizada continua cancelando', async () => {
    outsourced()
    const supabase = mergeSupabaseConfig({
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: null, workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    state.claudeResponses = [`Cancelado.
CANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    expect(requestExternalConfirmation).not.toHaveBeenCalled()
    const cancel = supabase.callsTo('appointments', 'update').find((c) => (c.payload as { status?: string }).status === 'cancelado')
    expect(cancel).toBeDefined()
    expect(lastSentMessage()).toBe('Cancelado.')
  })

  it('nenhuma mensagem de texto livre sai para o WhatsApp da clínica parceira', async () => {
    outsourced()
    completePatient()
    state.claudeResponses = [CLAUDE_OK]

    await processIncomingMessage(PARAMS)

    const destinations = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ to: string }]>).map((c) => c[0].to)
    expect(destinations.length).toBeGreaterThan(0)
    expect(destinations).not.toContain(CLINIC_PHONE)
  })
})

describe('processIncomingMessage — cancelamento em unidade terceirizada', () => {
  const CANCEL_MSG = `Cancelado.
CANCELAMENTO_CONFIRMADO: ${OLD_APPT}`

  beforeEach(() => {
    resetAgentHarness()
    requestExternalConfirmation.mockReset().mockResolvedValue({ kind: 'requested', appointmentId: 'ext-1' })
    notifyOutsourcedIssue.mockClear()
  })

  function cancelSetup() {
    return mergeSupabaseConfig({
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: 'ev1', workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
  }

  function cancelUpdates(supabase: ReturnType<typeof mergeSupabaseConfig>) {
    return supabase.callsTo('appointments', 'update').filter((c) => (c.payload as { status?: string }).status === 'cancelado')
  }

  it('a busca da consulta a cancelar inclui as pendentes de confirmação externa', async () => {
    outsourced()
    const supabase = cancelSetup()
    state.claudeResponses = [CANCEL_MSG]

    await processIncomingMessage(PARAMS)

    expect(JSON.stringify(supabase.callsTo('appointments', 'select'))).toContain('pendente_confirmacao_externa')
  })

  it.each(['pendente', 'confirmada'])('consulta %s em unidade terceirizada: cancela, apaga o evento e avisa a equipe', async () => {
    outsourced()
    const supabase = cancelSetup()
    state.claudeResponses = [CANCEL_MSG]

    await processIncomingMessage(PARAMS)

    expect(cancelUpdates(supabase)).toHaveLength(1)
    expect(deleteEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(cancelEvent).not.toHaveBeenCalled()
    expect(notifyOutsourcedIssue).toHaveBeenCalledWith({
      accountId: PARAMS.accountId,
      workspaceId: 'w1',
      appointmentId: OLD_APPT,
      reason: 'cancelamento_terceirizado',
    })
    expect(lastSentMessage()).toBe('Cancelado.')
    const destinations = (sendWhatsAppMessage.mock.calls as unknown as Array<[{ to: string }]>).map((c) => c[0].to)
    expect(destinations).not.toContain(CLINIC_PHONE)
  })

  it('unidade nativa: cancelEvent como antes e nenhum aviso', async () => {
    const supabase = cancelSetup()
    state.claudeResponses = [CANCEL_MSG]

    await processIncomingMessage(PARAMS)

    expect(cancelUpdates(supabase)).toHaveLength(1)
    expect(cancelEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(deleteEvent).not.toHaveBeenCalled()
    expect(notifyOutsourcedIssue).not.toHaveBeenCalled()
  })

  it('remarcação de consulta pendente com pedido feito cancela a pendente antiga', async () => {
    outsourced()
    const supabase = mergeSupabaseConfig({
      patients: { select: { data: { ...COMPLETE_PATIENT } }, update: { data: null } },
      appointments: {
        select: [{ data: [] }, { data: { id: OLD_APPT, gcal_event_id: 'ev1', workspace_id: 'w1' } }],
        update: { data: null },
      },
    })
    state.claudeResponses = [`${CLAUDE_OK}
CANCELAMENTO_CONFIRMADO: ${OLD_APPT}`]

    await processIncomingMessage(PARAMS)

    expect(cancelUpdates(supabase)).toHaveLength(1)
    expect(deleteEvent).toHaveBeenCalledWith('w1', 'ev1')
  })
})
