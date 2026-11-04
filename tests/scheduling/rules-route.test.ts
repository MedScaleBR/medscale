import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))

import { POST } from '@/app/api/availability/rules/route'
import { PATCH } from '@/app/api/availability/rules/[id]/route'

function setup(current: Record<string, unknown> | null = null) {
  g.supabase = createSupabaseMock({
    workspaces: { select: (call) => ({ data: { id: filterValue(call, 'eq', 'id'), account_id: 'a1' } }) },
    memberships: { select: { data: { role: 'owner', module_overrides: null, account: { modules: [] } } } },
    availability_rules: {
      insert: (call) => ({ data: { id: 'r1', ...(call.payload as object) } }),
      update: (call) => ({ data: { id: 'r1', ...(call.payload as object) } }),
      select: { data: current },
    },
  })
  g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'user1' } }, error: null })
}

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('https://app.test/api/availability/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'w1' },
      body: JSON.stringify({ day_of_week: 2, start_time: '08:00', end_time: '12:00', slot_duration: 30, ...body }),
    })
  )

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new NextRequest('https://app.test/api/availability/rules/r1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'w1' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'r1' }) }
  )

describe('API de expediente — repetição', () => {
  beforeEach(() => setup())

  it('toda semana: não grava as colunas novas (funciona antes da migration)', async () => {
    const res = await post({})
    expect(res.status).toBe(201)
    const payload = g.supabase.callsTo('availability_rules', 'insert')[0].payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('interval_weeks')
    expect(payload).not.toHaveProperty('anchor_date')
  })

  it('quinzenal com âncora na terça: grava', async () => {
    const res = await post({ interval_weeks: 2, anchor_date: '2025-11-11' })
    expect(res.status).toBe(201)
    expect(g.supabase.callsTo('availability_rules', 'insert')[0].payload).toMatchObject({ interval_weeks: 2, anchor_date: '2025-11-11' })
  })

  it('recusa intervalo fora de 1–4, âncora ausente e âncora em outro dia da semana', async () => {
    expect((await post({ interval_weeks: 5, anchor_date: '2025-11-11' })).status).toBe(400)
    expect((await post({ interval_weeks: 2 })).status).toBe(400)
    const wrongDay = await post({ interval_weeks: 2, anchor_date: '2025-11-12' })
    expect(wrongDay.status).toBe(400)
    expect((await wrongDay.json()).error).toMatch(/mesmo dia da semana/)
    expect(g.supabase.callsTo('availability_rules', 'insert')).toHaveLength(0)
  })

  it('PATCH valida contra o dia da semana atual da regra', async () => {
    setup({ id: 'r1', day_of_week: 2, interval_weeks: 1, anchor_date: null })
    expect((await patch({ interval_weeks: 2, anchor_date: '2025-11-12' })).status).toBe(400)
    expect((await patch({ interval_weeks: 2, anchor_date: '2025-11-11' })).status).toBe(200)
    expect(g.supabase.callsTo('availability_rules', 'update')[0].payload).toEqual({ interval_weeks: 2, anchor_date: '2025-11-11' })
  })

  it('PATCH trocando o dia de uma regra quinzenal exige âncora nova', async () => {
    setup({ id: 'r1', day_of_week: 2, interval_weeks: 2, anchor_date: '2025-11-11' })
    expect((await patch({ day_of_week: 3 })).status).toBe(400)
  })
})
