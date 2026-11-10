import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  createEvent: vi.fn(),
  applyRevenue: vi.fn(),
  queueLeadConversion: vi.fn(async () => undefined),
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
  createEvent: g.createEvent,
  cancelEvent: vi.fn(),
  updateEvent: vi.fn(),
}))
vi.mock('@/lib/google/auth', () => ({ isGoogleConnected: async () => ({ connected: false, email: null }) }))
vi.mock('@/lib/google/reconcile', () => ({ reconcileAccountCalendars: vi.fn() }))
vi.mock('@/lib/revenue/cycle', () => ({
  applyAppointmentRevenue: g.applyRevenue,
  syncRevenueEntryToAppointmentStatus: vi.fn(),
}))
vi.mock('@/lib/billing/guides', () => ({ ensureGuideSafely: vi.fn() }))

vi.mock('@/lib/meta/conversions', async (orig) => ({
  ...(await orig<typeof import('@/lib/meta/conversions')>()),
  queueLeadConversion: g.queueLeadConversion,
}))

import { POST } from '@/app/api/appointments/route'

const request = (body: unknown) =>
  new Request('https://app.test/api/appointments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

const BODY = { patient_name: 'Paciente Teste', patient_phone: '(11) 98765-4321', scheduled_at: '2026-11-20T13:00:00Z' }

describe('agendamento manual avisa a Meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agendamento manual dispara LeadSubmitted com appt:<id>', async () => {
    g.supabase = createSupabaseMock({
      appointments: { insert: { data: { id: 'a9', patient_phone: BODY.patient_phone, status: 'agendado', scheduled_at: BODY.scheduled_at } } },
    })
    const res = await POST(request(BODY))
    expect(res.status).toBe(201)
    expect(g.queueLeadConversion).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc1', patientPhone: BODY.patient_phone, dedupKey: 'appt:a9', appointmentId: 'a9' })
    )
  })

  it('não dispara quando o insert falha', async () => {
    g.supabase = createSupabaseMock({ appointments: { insert: { data: null, error: { message: 'boom' } } } })
    const res = await POST(request(BODY))
    expect(res.status).toBe(500)
    expect(g.queueLeadConversion).not.toHaveBeenCalled()
  })

  it('consulta criada já cancelada não dispara', async () => {
    g.supabase = createSupabaseMock({
      appointments: { insert: { data: { id: 'a9', patient_phone: BODY.patient_phone, status: 'cancelado', scheduled_at: BODY.scheduled_at } } },
    })
    await POST(request({ ...BODY, status: 'cancelado' }))
    expect(g.queueLeadConversion).not.toHaveBeenCalled()
  })
})
