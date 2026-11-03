import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const h = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => h.supabase.client }))

import { POST } from '@/app/api/cron/cleanup-insurance-cards/route'

const SECRET = 'a-very-long-cron-secret-123'
const req = (auth = `Bearer ${SECRET}`) =>
  new NextRequest('http://x/api/cron/cleanup-insurance-cards', { method: 'POST', headers: { authorization: auth } })

describe('cron cleanup-insurance-cards', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    delete process.env.INSURANCE_CARD_RETENTION_DAYS
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
    delete process.env.INSURANCE_CARD_RETENTION_DAYS
  })

  it('exige CRON_SECRET', async () => {
    h.supabase = createSupabaseMock()
    const res = await POST(req('Bearer errado-errado-errado'))
    expect(res.status).toBe(401)
  })

  it('retenção 0: apaga do Storage e marca deleted_at', async () => {
    process.env.INSURANCE_CARD_RETENTION_DAYS = '0'
    h.supabase = createSupabaseMock({
      conversation_attachments: {
        select: { data: [{ id: 'a1', storage_path: 'acc/c1/1.jpg' }, { id: 'a2', storage_path: 'acc/c2/2.png' }] },
        update: { data: null },
      },
    })

    const res = await POST(req())

    expect(await res.json()).toEqual({ deleted: 2 })
    expect(h.supabase.client.storage.from).toHaveBeenCalledWith('insurance-cards')
    expect(h.supabase.storage.remove).toHaveBeenCalledWith(['acc/c1/1.jpg', 'acc/c2/2.png'])
    const [update] = h.supabase.callsTo('conversation_attachments', 'update')
    expect(update.payload).toEqual({ deleted_at: expect.any(String) })
    const [select] = h.supabase.callsTo('conversation_attachments', 'select')
    const cutoff = new Date(filterValue(select, 'lte', 'created_at') as string).getTime()
    expect(Math.abs(cutoff - Date.now())).toBeLessThan(5000)
  })

  it('padrão de 90 dias e nada a apagar', async () => {
    h.supabase = createSupabaseMock({ conversation_attachments: { select: { data: [] } } })
    const res = await POST(req())
    expect(await res.json()).toEqual({ deleted: 0 })
    const [select] = h.supabase.callsTo('conversation_attachments', 'select')
    const days = (Date.now() - new Date(filterValue(select, 'lte', 'created_at') as string).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(90)
    expect(h.supabase.storage.remove).not.toHaveBeenCalled()
  })
})
