import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] },
  }),
  requireRole: () => null,
}))

import { PATCH } from '@/app/api/bot/config/route'

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://app.test/api/bot/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

describe('PATCH /api/bot/config', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({ bot_config: { upsert: { data: { account_id: 'acc1' } } } })
  })

  it('ignora procedures e insurance_plans e só grava o que veio', async () => {
    const res = await patch({ procedures: ['x'], insurance_plans: ['Unimed'], tone_of_voice: 'Calma' })

    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('bot_config', 'upsert')
    expect(call.payload).toEqual({ tone_of_voice: 'Calma', account_id: 'acc1' })
  })
})
