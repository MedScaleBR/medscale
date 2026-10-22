import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
const sendHandoffPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/push/send', () => ({ sendHandoffPush }))

import { notifyOutsourcedIssue, type OutsourcedIssueReason } from '@/lib/outsourced/notify'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    workspaces: { select: { data: { name: 'IAD Pituba' } } },
    appointments: { select: { data: { patient_phone: '5571999990000' } } },
    handoff_logs: { insert: { data: null } },
    ...config,
  })
}

const base = { accountId: 'a1', workspaceId: 'w1', appointmentId: 'ap1' }

describe('notifyOutsourcedIssue', () => {
  beforeEach(() => {
    sendHandoffPush.mockClear()
    setup()
  })

  it('registra em handoff_logs sem conversa e sem tocar em conversations', async () => {
    await notifyOutsourcedIssue({ ...base, reason: 'clinica_externa_ambiguo', rawText: 'Marilene talvez' })

    const inserts = g.supabase.callsTo('handoff_logs', 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toEqual({
      workspace_id: 'w1',
      conversation_id: null,
      patient_phone: '5571999990000',
      trigger_reason: 'clinica_externa_ambiguo',
      handoff_to: null,
      flagged_content: 'Marilene talvez',
    })
    expect(g.supabase.callsTo('conversations')).toHaveLength(0)
  })

  it('sem appointmentId grava patient_phone e flagged_content nulos', async () => {
    await notifyOutsourcedIssue({ accountId: 'a1', workspaceId: 'w1', reason: 'clinica_externa_config' })

    const payload = g.supabase.callsTo('handoff_logs', 'insert')[0].payload as Record<string, unknown>
    expect(payload.patient_phone).toBeNull()
    expect(payload.flagged_content).toBeNull()
    expect(g.supabase.callsTo('appointments')).toHaveLength(0)
  })

  const cases: Array<[OutsourcedIssueReason, string]> = [
    ['clinica_externa_ambiguo', 'IAD Pituba: resposta da clínica parceira precisa de revisão'],
    ['clinica_externa_negacao', 'IAD Pituba: resposta da clínica parceira precisa de revisão'],
    ['clinica_externa_timeout', 'IAD Pituba: clínica parceira ainda não confirmou uma solicitação'],
    ['cancelamento_terceirizado', 'IAD Pituba: paciente cancelou — avise a clínica parceira'],
    ['clinica_externa_falha_envio', 'IAD Pituba: não foi possível enviar a solicitação à clínica parceira'],
    ['clinica_externa_config', 'IAD Pituba: o mesmo WhatsApp de clínica parceira está em mais de uma unidade'],
  ]
  it.each(cases)('push para %s tem o texto fixo', async (reason, body) => {
    await notifyOutsourcedIssue({ ...base, reason, rawText: 'Marilene 5571999990000' })

    expect(sendHandoffPush).toHaveBeenCalledWith('w1', { title: '⚠️ Clínica parceira', body, url: '/agenda' })
  })

  it('o payload do push nunca contém rawText nem telefone', async () => {
    await notifyOutsourcedIssue({ ...base, reason: 'clinica_externa_ambiguo', rawText: 'Marilene 5571999990000' })

    expect(JSON.stringify(sendHandoffPush.mock.calls)).not.toMatch(/5571|Marilene/)
  })

  it('usa "Unidade" quando a workspace não tem nome', async () => {
    setup({ workspaces: { select: { data: null } } })
    await notifyOutsourcedIssue({ ...base, reason: 'clinica_externa_timeout' })

    expect(sendHandoffPush).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ body: 'Unidade: clínica parceira ainda não confirmou uma solicitação' })
    )
  })

  it('erro no insert não lança e o push ainda sai', async () => {
    setup({ handoff_logs: { insert: { data: null, error: { message: 'boom' } } } })

    await expect(notifyOutsourcedIssue({ ...base, reason: 'clinica_externa_negacao' })).resolves.toBeUndefined()
    expect(sendHandoffPush).toHaveBeenCalledTimes(1)
  })

  it('nunca lança, mesmo se o client e o push falharem', async () => {
    g.supabase = {
      client: {
        from: () => {
          throw new Error('db fora')
        },
      },
    } as unknown as SupabaseMock
    sendHandoffPush.mockRejectedValueOnce(new Error('push fora'))

    await expect(notifyOutsourcedIssue({ ...base, reason: 'clinica_externa_negacao' })).resolves.toBeUndefined()
  })
})
