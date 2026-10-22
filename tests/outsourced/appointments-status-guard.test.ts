import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  createEvent: vi.fn(),
  applyRevenue: vi.fn(),
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

import { POST } from '@/app/api/appointments/route'
import { PATCH } from '@/app/api/appointments/[id]/route'
import { PENDING_STATUS_FORBIDDEN_ERROR } from '@/lib/outsourced/config'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock(config)
}

const request = (method: string, body: unknown) =>
  new Request('https://app.test/api/appointments', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

describe('status pendente_confirmacao_externa é só da Clara', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it('POST /api/appointments rejeita o status manual e não grava nada', async () => {
    const res = await POST(request('POST', {
      patient_name: 'Paciente Teste',
      patient_phone: '11987654321',
      scheduled_at: '2026-10-30T13:00:00Z',
      status: 'pendente_confirmacao_externa',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(PENDING_STATUS_FORBIDDEN_ERROR)
    expect(g.supabase.callsTo('appointments', 'insert')).toHaveLength(0)
    expect(g.createEvent).not.toHaveBeenCalled()
    expect(g.applyRevenue).not.toHaveBeenCalled()
  })

  it('PATCH /api/appointments/[id] rejeita mudar uma consulta agendada para pendente', async () => {
    setup({
      appointments: {
        select: {
          data: {
            id: 'a1', workspace_id: 'w1', account_id: 'acc1', patient_id: 'pat1',
            status: 'agendado', gcal_event_id: null, health_plan: null, procedure_id: null,
            duration_min: 30, scheduled_at: '2026-10-30T13:00:00Z',
          },
        },
      },
    })

    const res = await PATCH(request('PATCH', { status: 'pendente_confirmacao_externa' }), {
      params: Promise.resolve({ id: 'a1' }),
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(PENDING_STATUS_FORBIDDEN_ERROR)
    expect(g.supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })
})
