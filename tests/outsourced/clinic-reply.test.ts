import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const m = vi.hoisted(() => ({
  supabase: null as unknown as { client: unknown },
  confirmOutsourcedAppointment: vi.fn(),
  notifyOutsourcedIssue: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => m.supabase.client }))
vi.mock('@/lib/outsourced/confirm', () => ({ confirmOutsourcedAppointment: m.confirmOutsourcedAppointment }))
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue: m.notifyOutsourcedIssue }))
vi.mock('@/lib/whatsapp/send', () => ({
  sendWhatsAppMessage: m.sendWhatsAppMessage,
  sendTemplateMessage: m.sendTemplateMessage,
}))

import { processClinicReplyMessage, resolveClinicSender, type ClinicInboundMessage } from '@/lib/outsourced/clinic-reply'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'

const COM_NOME = 'CONSULTA AGENDADA - IAD PITUBA\n\nMarilene Ribeiro\n\nMédico: Dr Gutemberg Brito\nHorário: 09:00\nData: 09/10/2026\n📍Nosso endereço: ...'
const SEM_NOME = 'CONSULTA AGENDADA - IAD PITUBA\n\nMédico: Dr Gutemberg Brito\nHorário: 09:00\nData: 09/10/2026'
const SCHEDULED_ISO = '2026-10-09T12:00:00.000Z'

let supabase: SupabaseMock
let consoleSpies: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; log: ReturnType<typeof vi.spyOn> }

function setup(overrides: SupabaseMockConfig = {}) {
  supabase = createSupabaseMock({
    clinic_confirmations: { insert: { data: { id: 'cc1' } }, update: { data: null } },
    appointments: { select: { data: [] } },
    ...overrides,
  })
  m.supabase = supabase
  return supabase
}

const text = (body: string, id = 'wamid.in'): ClinicInboundMessage => ({ id, type: 'text', text: { body } })

function run(message: ClinicInboundMessage) {
  return processClinicReplyMessage({ accountId: 'acc1', workspaceId: 'w1', message })
}

function expectNoPatientSideEffects() {
  for (const table of ['patients', 'conversations', 'messages']) expect(supabase.callsTo(table)).toHaveLength(0)
  expect(supabase.callsTo('appointments', 'update')).toHaveLength(0)
  expect(m.sendWhatsAppMessage).not.toHaveBeenCalled()
  expect(m.sendTemplateMessage).not.toHaveBeenCalled()
}

const classificationUpdate = () => supabase.callsTo('clinic_confirmations', 'update')[0]

describe('processClinicReplyMessage', () => {
  beforeEach(() => {
    setup()
    m.confirmOutsourcedAppointment.mockReset().mockResolvedValue({ ok: true, appointmentId: 'ap1' })
    m.notifyOutsourcedIssue.mockReset().mockResolvedValue(undefined)
    m.sendWhatsAppMessage.mockReset()
    m.sendTemplateMessage.mockReset()
    consoleSpies = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    // LGPD: logs nunca carregam o texto da clínica nem o nome do paciente.
    expect(
      JSON.stringify([consoleSpies.error.mock.calls, consoleSpies.warn.mock.calls, consoleSpies.log.mock.calls])
    ).not.toMatch(/Marilene|Ribeiro|CONSULTA|hor[aá]rio|Gutemberg/i)
    vi.restoreAllMocks()
  })

  it('mensagem repetida (whatsapp_id já gravado) → para sem consultar consultas nem notificar', async () => {
    setup({ clinic_confirmations: { insert: { data: null, error: { code: '23505', message: 'duplicate' } } } })

    await run(text(COM_NOME))

    expect(supabase.callsTo('appointments')).toHaveLength(0)
    expect(supabase.callsTo('clinic_confirmations', 'update')).toHaveLength(0)
    expect(m.notifyOutsourcedIssue).not.toHaveBeenCalled()
    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
  })

  it('grava a mensagem recebida e nunca toca em paciente, conversa ou mensagens', async () => {
    await run(text('não tenho esse horário', 'wamid.42'))

    expect(supabase.callsTo('clinic_confirmations', 'insert')[0].payload).toEqual({
      account_id: 'acc1',
      workspace_id: 'w1',
      direction: 'inbound',
      raw_text: 'não tenho esse horário',
      whatsapp_id: 'wamid.42',
    })
    expectNoPatientSideEffects()
  })

  it('áudio → ambiguo, avisa a equipe sem texto e grava o marcador', async () => {
    await run({ id: 'wamid.audio', type: 'audio' })

    expect(supabase.callsTo('clinic_confirmations', 'insert')[0].payload).toMatchObject({
      raw_text: '[audio recebido]',
      whatsapp_id: 'wamid.audio',
    })
    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(filterValue(classificationUpdate(), 'eq', 'id')).toBe('cc1')
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledTimes(1)
    const [arg] = m.notifyOutsourcedIssue.mock.calls[0]
    expect(arg).toMatchObject({ accountId: 'acc1', workspaceId: 'w1', reason: 'clinica_externa_ambiguo' })
    expect(arg.rawText ?? null).toBeNull()
    expect(supabase.callsTo('appointments')).toHaveLength(0)
    expectNoPatientSideEffects()
  })

  it('"não tenho esse horário" → negacao e equipe recebe o texto', async () => {
    await run(text('não tenho esse horário'))

    expect(classificationUpdate().payload).toMatchObject({ classification: 'negacao' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', reason: 'clinica_externa_negacao', rawText: 'não tenho esse horário' })
    )
    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
    expectNoPatientSideEffects()
  })

  it('"pode ser às 9h?" → ambiguo', async () => {
    await run(text('pode ser às 9h?'))

    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'clinica_externa_ambiguo', rawText: 'pode ser às 9h?' })
    )
    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
    expectNoPatientSideEffects()
  })

  it('template com nome e 1 pendente no horário → confirma e registra', async () => {
    setup({ appointments: { select: { data: [{ id: 'ap1', patient_name: 'Outra Pessoa' }] } } })

    await run(text(COM_NOME))

    const q = supabase.callsTo('appointments', 'select')[0]
    expect(filterValue(q, 'eq', 'workspace_id')).toBe('w1')
    expect(filterValue(q, 'eq', 'status')).toBe(PENDING_EXTERNAL_STATUS)
    expect(filterValue(q, 'eq', 'scheduled_at')).toBe(SCHEDULED_ISO)
    expect(m.confirmOutsourcedAppointment).toHaveBeenCalledWith('ap1')
    expect(classificationUpdate().payload).toEqual({ appointment_id: 'ap1', classification: 'confirmacao' })
    expect(filterValue(classificationUpdate(), 'eq', 'id')).toBe('cc1')
    expect(m.notifyOutsourcedIssue).not.toHaveBeenCalled()
    expectNoPatientSideEffects()
  })

  it('2 pendentes no mesmo horário e template sem nome → ambiguo, nada confirmado', async () => {
    setup({
      appointments: {
        select: { data: [{ id: 'ap1', patient_name: 'Marilene Ribeiro' }, { id: 'ap2', patient_name: 'João Lima' }] },
      },
    })

    await run(text(SEM_NOME))

    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(expect.objectContaining({ reason: 'clinica_externa_ambiguo' }))
  })

  it('2 pendentes e o nome do template casa um deles → confirma esse', async () => {
    setup({
      appointments: {
        select: { data: [{ id: 'ap1', patient_name: 'João Lima' }, { id: 'ap2', patient_name: 'MARILENE RIBEIRO' }] },
      },
    })
    m.confirmOutsourcedAppointment.mockResolvedValue({ ok: true, appointmentId: 'ap2' })

    await run(text(COM_NOME))

    expect(m.confirmOutsourcedAppointment).toHaveBeenCalledWith('ap2')
    expect(classificationUpdate().payload).toEqual({ appointment_id: 'ap2', classification: 'confirmacao' })
  })

  it('nenhum pendente no horário (ex.: paciente já cancelou) → ambiguo', async () => {
    await run(text(COM_NOME))

    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'clinica_externa_ambiguo', rawText: COM_NOME })
    )
  })

  it('corrida: a consulta deixou de estar pendente na hora de confirmar → ambiguo + aviso', async () => {
    setup({ appointments: { select: { data: [{ id: 'ap1', patient_name: 'Marilene Ribeiro' }] } } })
    m.confirmOutsourcedAppointment.mockResolvedValue({ ok: false, reason: 'not_pending' })

    await run(text(COM_NOME))

    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', appointmentId: 'ap1', reason: 'clinica_externa_ambiguo' })
    )
  })

  it('confirmação falha com erro → ambiguo + aviso (a equipe não fica sem saber)', async () => {
    setup({ appointments: { select: { data: [{ id: 'ap1', patient_name: 'Marilene Ribeiro' }] } } })
    m.confirmOutsourcedAppointment.mockRejectedValue(new Error('db down'))

    await run(text(COM_NOME))

    expect(classificationUpdate().payload).toMatchObject({ classification: 'ambiguo' })
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(expect.objectContaining({ reason: 'clinica_externa_ambiguo' }))
  })

  it('consulta de pendentes falha → ambiguo, nada confirmado', async () => {
    setup({ appointments: { select: { data: null, error: { message: 'boom' } } } })

    await run(text(COM_NOME))

    expect(m.confirmOutsourcedAppointment).not.toHaveBeenCalled()
    expect(m.notifyOutsourcedIssue).toHaveBeenCalledWith(expect.objectContaining({ reason: 'clinica_externa_ambiguo' }))
  })

  it('loga só workspace, classificação e número de candidatos', async () => {
    setup({ appointments: { select: { data: [{ id: 'ap1', patient_name: 'Marilene Ribeiro' }] } } })

    await run(text(COM_NOME))

    expect(consoleSpies.log).toHaveBeenCalledWith('[outsourced] reply workspace=w1 classification=confirmacao candidates=1')
  })
})

describe('resolveClinicSender', () => {
  it('busca as unidades terceirizadas da account e casa o telefone', async () => {
    const sb = createSupabaseMock({
      workspaces: {
        select: {
          data: [
            { id: 'w1', is_outsourced: true, external_clinic_phone: '5571999990000' },
            { id: 'w2', is_outsourced: true, external_clinic_phone: '5571911112222' },
          ],
        },
      },
    })

    const res = await resolveClinicSender(sb.client as never, 'acc1', '557199990000')

    expect(res).toEqual({ kind: 'match', workspaceId: 'w1' })
    const q = sb.callsTo('workspaces', 'select')[0]
    expect(filterValue(q, 'eq', 'account_id')).toBe('acc1')
    expect(filterValue(q, 'eq', 'is_outsourced')).toBe(true)
    expect(q.filters).toContainEqual(['not', 'external_clinic_phone', 'is', null])
  })

  it('nenhuma unidade terceirizada → none', async () => {
    const sb = createSupabaseMock({ workspaces: { select: { data: [] } } })

    await expect(resolveClinicSender(sb.client as never, 'acc1', '5571988887777')).resolves.toEqual({ kind: 'none' })
  })

  it('erro na consulta → lança (o webhook segue o fluxo de paciente)', async () => {
    const sb = createSupabaseMock({ workspaces: { select: { data: null, error: { message: 'boom' } } } })

    await expect(resolveClinicSender(sb.client as never, 'acc1', '5571988887777')).rejects.toThrow()
  })
})
