import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] },
  }),
}))

import { PATCH } from '@/app/api/bot/conversations/[id]/route'

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://app.test/api/bot/conversations/c9', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c9' }) },
  )

describe('PATCH /api/bot/conversations/[id]', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({ conversations: { update: { data: { id: 'c9' } } } })
  })

  it('age em conversa de qualquer unidade da account (ou sem unidade), não só da unidade selecionada', async () => {
    const res = await patch({ archived: true })

    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('conversations', 'update')
    expect(call.filters).toContainEqual(['eq', 'account_id', 'acc1'])
    expect(call.filters).not.toContainEqual(['eq', 'workspace_id', 'w1'])
  })
})
