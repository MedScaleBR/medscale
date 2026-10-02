import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({ session: { userId: 'u1', workspaceId: 'w1' } }),
}))

import { datesInRange, groupBlockedDays } from '@/lib/availability/blocked-ranges'
import { DELETE, POST } from '@/app/api/availability/exceptions/route'

function request(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/availability/exceptions', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('datesInRange', () => {
  it('inclui as duas pontas e atravessa a virada de mês e de ano', () => {
    expect(datesInRange('2030-12-30', '2031-01-02')).toEqual(['2030-12-30', '2030-12-31', '2031-01-01', '2031-01-02'])
  })
})

describe('groupBlockedDays', () => {
  it('junta dias seguidos com o mesmo motivo e separa buracos ou motivos diferentes', () => {
    const ranges = groupBlockedDays([
      { id: 'c', date: '2030-07-03', reason: 'Férias' },
      { id: 'a', date: '2030-07-01', reason: 'Férias' },
      { id: 'b', date: '2030-07-02', reason: 'Férias' },
      { id: 'd', date: '2030-07-04', reason: 'Congresso' },
      { id: 'e', date: '2030-07-10', reason: 'Congresso' },
    ])
    expect(ranges).toEqual([
      { start: '2030-07-01', end: '2030-07-03', reason: 'Férias', ids: ['a', 'b', 'c'] },
      { start: '2030-07-04', end: '2030-07-04', reason: 'Congresso', ids: ['d'] },
      { start: '2030-07-10', end: '2030-07-10', reason: 'Congresso', ids: ['e'] },
    ])
  })
})

describe('POST /api/availability/exceptions com período', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({
      availability_exceptions: {
        select: { data: [{ date: '2030-07-02' }] },
        insert: (call) => ({ data: call.payload }),
      },
    })
  })

  it('grava um bloqueio por dia, pulando os dias já bloqueados', async () => {
    const res = await POST(request('POST', { date: '2030-07-01', end_date: '2030-07-03', type: 'blocked', reason: 'Férias' }))
    expect(res.status).toBe(201)
    const insert = g.supabase.callsTo('availability_exceptions', 'insert')[0]
    expect(insert.payload).toEqual([
      expect.objectContaining({ workspace_id: 'w1', date: '2030-07-01', type: 'blocked', reason: 'Férias', start_time: null }),
      expect.objectContaining({ workspace_id: 'w1', date: '2030-07-03', type: 'blocked', reason: 'Férias', start_time: null }),
    ])
    expect(await res.json()).toHaveLength(2)
  })

  it('recusa período invertido ou maior que um ano', async () => {
    expect((await POST(request('POST', { date: '2030-07-03', end_date: '2030-07-01', type: 'blocked' }))).status).toBe(400)
    expect((await POST(request('POST', { date: '2030-01-01', end_date: '2031-06-01', type: 'blocked' }))).status).toBe(400)
    expect(g.supabase.callsTo('availability_exceptions', 'insert')).toHaveLength(0)
  })

  it('sem end_date continua gravando um único dia', async () => {
    g.supabase = createSupabaseMock({ availability_exceptions: { insert: (call) => ({ data: call.payload }) } })
    const res = await POST(request('POST', { date: '2030-07-01', type: 'blocked' }))
    expect(await res.json()).toEqual(expect.objectContaining({ date: '2030-07-01' }))
  })
})

describe('DELETE /api/availability/exceptions', () => {
  it('remove o período inteiro restrito ao local da sessão', async () => {
    g.supabase = createSupabaseMock()
    const res = await DELETE(request('DELETE', { ids: ['a', 'b'] }))
    expect(res.status).toBe(200)
    const call = g.supabase.callsTo('availability_exceptions', 'delete')[0]
    expect(filterValue(call, 'in', 'id')).toEqual(['a', 'b'])
    expect(filterValue(call, 'eq', 'workspace_id')).toBe('w1')
  })
})
