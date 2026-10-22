import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  cancelEvent: vi.fn(),
  deleteEvent: vi.fn(),
  updateEvent: vi.fn(),
  confirm: vi.fn(),
  applyRevenue: vi.fn(),
  syncRevenue: vi.fn(),
  notifyIssue: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'member', modules: ['agenda'] },
  }),
  requireModule: () => null,
}))
vi.mock('@/lib/google/calendar', () => ({
  cancelEvent: g.cancelEvent,
  deleteEvent: g.deleteEvent,
  updateEvent: g.updateEvent,
}))
vi.mock('@/lib/outsourced/confirm', () => ({ confirmOutsourcedAppointment: g.confirm }))
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue: g.notifyIssue }))
vi.mock('@/lib/revenue/cycle', () => ({
  applyAppointmentRevenue: g.applyRevenue,
  syncRevenueEntryToAppointmentStatus: g.syncRevenue,
}))
vi.mock('@/lib/billing/guides', () => ({ ensureGuideSafely: vi.fn() }))
vi.mock('@/lib/billing/appointments', () => ({
  resolveAppointmentBilling: async () => ({ ok: true, fields: null }),
}))

import { PATCH, DELETE } from '@/app/api/appointments/[id]/route'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', workspace_id: 'w1', account_id: 'acc1', patient_id: 'pat1',
  status: 'pendente_confirmacao_externa', gcal_event_id: 'ev1', health_plan: null,
  procedure_id: null, duration_min: 30, scheduled_at: '2026-10-30T13:00:00Z', notes: null,
  ...over,
})

const OUTSOURCED = { select: { data: { is_outsourced: true, external_clinic_phone: '5571999990000' } } }
const NATIVE = { select: { data: { is_outsourced: false, external_clinic_phone: null } } }

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock(config)
}

const req = (method: string, body?: unknown) =>
  new Request('https://app.test/api/appointments/a1', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
const ctx = { params: Promise.resolve({ id: 'a1' }) }

describe('agenda manual em unidade terceirizada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it('PATCH pendente para confirmado delega ao confirm, não grava status nem aplica receita', async () => {
    const confirmedRow = row({ status: 'confirmado' })
    setup({
      appointments: { select: [{ data: row() }, { data: confirmedRow }], update: { data: row() } },
    })
    g.confirm.mockResolvedValue({ ok: true, appointmentId: 'a1' })

    const res = await PATCH(req('PATCH', { status: 'confirmado', notes: 'obs' }), ctx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(confirmedRow)
    const updates = g.supabase.callsTo('appointments', 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).not.toHaveProperty('status')
    expect(g.confirm).toHaveBeenCalledTimes(1)
    expect(g.confirm).toHaveBeenCalledWith('a1')
    expect(g.applyRevenue).not.toHaveBeenCalled()
    expect(g.notifyIssue).not.toHaveBeenCalled()
  })

  it('PATCH só com status não faz update vazio', async () => {
    setup({ appointments: { select: [{ data: row() }, { data: row({ status: 'confirmado' }) }] } })
    g.confirm.mockResolvedValue({ ok: true, appointmentId: 'a1' })

    const res = await PATCH(req('PATCH', { status: 'confirmado' }), ctx)

    expect(res.status).toBe(200)
    expect(g.supabase.callsTo('appointments', 'update')).toHaveLength(0)
    expect(g.confirm).toHaveBeenCalledWith('a1')
  })

  it('confirm com not_pending devolve 409', async () => {
    setup({ appointments: { select: { data: row() } } })
    g.confirm.mockResolvedValue({ ok: false, reason: 'not_pending' })

    const res = await PATCH(req('PATCH', { status: 'confirmado' }), ctx)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Esta consulta já não está aguardando a clínica parceira.' })
  })

  it('confirm lançando erro de banco devolve 500 genérico', async () => {
    setup({ appointments: { select: { data: row() } } })
    g.confirm.mockRejectedValue(new Error('db down: Fulano 11987654321'))

    const res = await PATCH(req('PATCH', { status: 'confirmado' }), ctx)

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('Fulano')
  })

  it.each(['pendente_confirmacao_externa', 'confirmado'])(
    'PATCH cancelado de consulta %s em unidade terceirizada apaga o evento',
    async (status) => {
      setup({
        appointments: { select: { data: row({ status }) }, update: { data: row({ status: 'cancelado' }) } },
        workspaces: OUTSOURCED,
      })

      const res = await PATCH(req('PATCH', { status: 'cancelado' }), ctx)

      expect(res.status).toBe(200)
      expect(g.deleteEvent).toHaveBeenCalledWith('w1', 'ev1')
      expect(g.cancelEvent).not.toHaveBeenCalled()
      expect(g.confirm).not.toHaveBeenCalled()
      expect(g.notifyIssue).not.toHaveBeenCalled()
    }
  )

  it('PATCH cancelado em unidade nativa usa cancelEvent', async () => {
    setup({
      appointments: { select: { data: row({ status: 'confirmado' }) }, update: { data: row({ status: 'cancelado' }) } },
      workspaces: NATIVE,
    })

    const res = await PATCH(req('PATCH', { status: 'cancelado' }), ctx)

    expect(res.status).toBe(200)
    expect(g.cancelEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(g.deleteEvent).not.toHaveBeenCalled()
  })

  it('DELETE em unidade terceirizada apaga o evento', async () => {
    setup({
      appointments: {
        select: { data: { gcal_event_id: 'ev1', status: 'pendente_confirmacao_externa' } },
        update: { data: { gcal_event_id: 'ev1' } },
      },
      workspaces: OUTSOURCED,
    })

    const res = await DELETE(req('DELETE'), ctx)

    expect(res.status).toBe(200)
    expect(g.deleteEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(g.cancelEvent).not.toHaveBeenCalled()
    expect(g.notifyIssue).not.toHaveBeenCalled()
  })

  it('DELETE em unidade nativa usa cancelEvent', async () => {
    setup({
      appointments: {
        select: { data: { gcal_event_id: 'ev1', status: 'confirmado' } },
        update: { data: { gcal_event_id: 'ev1' } },
      },
      workspaces: NATIVE,
    })

    const res = await DELETE(req('DELETE'), ctx)

    expect(res.status).toBe(200)
    expect(g.cancelEvent).toHaveBeenCalledWith('w1', 'ev1')
    expect(g.deleteEvent).not.toHaveBeenCalled()
  })
})
