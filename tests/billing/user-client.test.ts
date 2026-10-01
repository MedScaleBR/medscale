import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  user: null as unknown as SupabaseMock,
  admin: vi.fn(),
  createBatches: vi.fn(),
  tracked: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.user.client,
  createAdminClient: g.admin,
}))
vi.mock('@/lib/billing/access', () => ({
  requireBilling: async () => ({ session: { userId: 'doctor1', accountId: 'acc1', workspaceId: 'ws1', role: 'admin' } }),
}))
vi.mock('@/lib/analytics/posthog-server', () => ({
  trackBillingGuideCreated: g.tracked,
  trackBillingBatchGenerated: vi.fn(),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/billing/batches', async (original) => ({
  ...await original<typeof import('@/lib/billing/batches')>(),
  createBatchesForInsurer: g.createBatches,
}))

import { ensureGuideForAppointment } from '@/lib/billing/guides'
import { POST as generateBatch } from '@/app/api/billing/batches/route'

beforeEach(() => {
  vi.clearAllMocks()
  g.user = createSupabaseMock()
  g.admin.mockImplementation(() => { throw new Error('service client outside cron') })
})

describe('operações de usuário respeitam a sessão e RLS', () => {
  it('gera a guia por RPC autorizado sem ler snapshot ou usar service role', async () => {
    g.user.rpc.mockResolvedValue({
      data: { status: 'created', guideId: 'g1', guideStatus: 'draft', accountId: 'acc1', guideType: 'consulta', hasMissingFields: true },
      error: null,
    })

    expect(await ensureGuideForAppointment('ap1')).toEqual({ status: 'created', guideId: 'g1', guideStatus: 'draft' })
    expect(g.admin).not.toHaveBeenCalled()
    expect(g.user.rpc).toHaveBeenCalledWith('ensure_tiss_guide_for_appointment', { p_appointment_id: 'ap1' })
    expect(g.user.callsTo('tiss_guides')).toHaveLength(0)
    expect(g.tracked).toHaveBeenCalledWith('acc1', { guide_type: 'consulta', has_missing_fields: true })
  })

  it('não informa nova guia ou analytics quando o RPC encontra a guia existente', async () => {
    g.user.rpc.mockResolvedValue({ data: { status: 'exists', guideId: 'g1' }, error: null })

    expect(await ensureGuideForAppointment('ap1')).toEqual({ status: 'exists', guideId: 'g1' })
    expect(g.tracked).not.toHaveBeenCalled()
    expect(g.admin).not.toHaveBeenCalled()
  })

  it('gera lote manual com o client autenticado no banco', async () => {
    g.user = createSupabaseMock({ health_insurers: { select: { data: { id: 'ins1', account_id: 'acc1', tiss_version: '4.03.00' } } } })
    g.admin.mockReturnValue({ storage: g.user.client.storage })
    g.createBatches.mockResolvedValue([])
    const request = new NextRequest('http://localhost/api/billing/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ insurer_id: 'ins1' }),
    })

    const response = await generateBatch(request)
    expect(response.status).toBe(200)
    expect(g.createBatches.mock.calls[0][0]).toBe(g.user.client)
  })
})
