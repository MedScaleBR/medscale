import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/server', () => ({ resolveActiveSession: async () => ({ workspaceId: 'w1' }) }))
vi.mock('@/lib/google/calendar', () => ({ listEvents: async () => [] }))

import { POST } from '@/app/api/availability/rules/route'
import { getFreeSlotsForBot } from '@/lib/google/availability'

describe('expediente cadastrado no local escolhido e consultado pela Clara', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-09-16T07:00:00-03:00'))
    const saved: Array<Record<string, unknown>> = [
      { workspace_id: 'w1', day_of_week: 1, is_active: true, start_time: '08:00', end_time: '09:00', slot_duration: 30 },
    ]
    g.supabase = createSupabaseMock({
      workspaces: { select: (call) => ({ data: ['w1', 'w2'].includes(filterValue(call, 'eq', 'id') as string) ? { id: filterValue(call, 'eq', 'id'), account_id: 'a1' } : null }) },
      memberships: { select: { data: { role: 'owner', module_overrides: null, account: { modules: [] } } } },
      availability_rules: {
        insert: (call) => {
          const row = { id: 'r2', is_active: true, ...(call.payload as Record<string, unknown>) }
          saved.push(row)
          return { data: row }
        },
        select: (call) => ({ data: saved.filter((r) => r.workspace_id === filterValue(call, 'eq', 'workspace_id') && r.day_of_week === filterValue(call, 'eq', 'day_of_week')) }),
      },
      availability_exceptions: { select: { data: [] } },
      appointments: { select: { data: [] } },
    })
    g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'user1' } }, error: null })
  })

  afterEach(() => vi.useRealTimers())

  function request(workspaceId: string) {
    return new NextRequest('https://app.test/api/availability/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({ day_of_week: 1, start_time: '14:00', end_time: '15:00', slot_duration: 30 }),
    })
  }

  it('salva em outro local da conta e oferece à Clara somente os horários desse local', async () => {
    const response = await POST(request('w2'))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ workspace_id: 'w2', start_time: '14:00' })
    const monday = new Date('2030-09-16T12:00:00-03:00')
    expect(await getFreeSlotsForBot('w2', monday)).toEqual(['14:00', '14:30'])
    expect(await getFreeSlotsForBot('w1', monday)).toEqual(['08:00', '08:30'])
  })

  it('rejeita o cadastro em um local sem acesso', async () => {
    const response = await POST(request('other-account'))
    expect(response.status).toBe(403)
    expect(g.supabase.callsTo('availability_rules', 'insert')).toHaveLength(0)
  })
})
