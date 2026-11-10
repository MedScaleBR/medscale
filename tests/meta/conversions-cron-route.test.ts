import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))

const sendConversionEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/conversions', () => ({ sendConversionEvent }))

import { POST } from '@/app/api/cron/meta-conversions/route'

const CRON_SECRET = 'cron-secret-test'

function request(secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/cron/meta-conversions', { method: 'POST', headers }) as never
}

beforeEach(() => {
  sendConversionEvent.mockReset()
  g.supabase = createSupabaseMock({
    meta_conversion_events: { select: { data: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], error: null } },
  })
})

describe('POST /api/cron/meta-conversions', () => {
  it('recusa sem CRON_SECRET (401) e não consulta o banco', async () => {
    const res = await POST(request(null))
    expect(res.status).toBe(401)
    expect(g.supabase.callsTo('meta_conversion_events', 'select')).toHaveLength(0)
  })

  it('filtra por status, attempts < 5 e janela de 7 dias', async () => {
    sendConversionEvent.mockResolvedValue('sent')
    const before = Date.now()
    await POST(request())
    const [call] = g.supabase.callsTo('meta_conversion_events', 'select')
    expect(filterValue(call, 'in', 'status')).toEqual(['pending', 'failed'])
    expect(filterValue(call, 'lt', 'attempts')).toBe(5)
    const since = new Date(filterValue(call, 'gte', 'event_time') as string).getTime()
    expect(before - since).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000)
    expect(before - since).toBeLessThanOrEqual(7 * 86_400_000 + 1000)
  })

  it('conta enviados e falhos', async () => {
    sendConversionEvent.mockResolvedValueOnce('sent').mockResolvedValueOnce('failed').mockResolvedValueOnce('sent')
    const res = await POST(request())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ processed: 3, sent: 2, failed: 1 })
    expect(sendConversionEvent).toHaveBeenCalledWith('e1', g.supabase.client)
  })
})
