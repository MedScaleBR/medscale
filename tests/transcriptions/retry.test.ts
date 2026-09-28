import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  admin: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.admin.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireModule: (session: { modules: string[] }, mod: string) =>
      session.modules.includes(mod)
        ? null
        : NR.json({ error: `Módulo '${mod}' não está ativo no seu plano` }, { status: 403 }),
  }
})

import { POST as retry } from '@/app/api/transcriptions/[id]/retry/route'

const SESSION = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: ['transcriptions'] }

function setup(status: string | null) {
  g.supabase = createSupabaseMock({
    transcriptions: { select: { data: status ? { id: 't1', status } : null }, update: { data: null } },
  })
  g.admin = createSupabaseMock({})
}

function call() {
  const req = new Request('https://app.test/api/transcriptions/t1/retry', { method: 'POST' }) as never
  return retry(req, { params: Promise.resolve({ id: 't1' }) })
}

describe('POST /api/transcriptions/[id]/retry', () => {
  beforeEach(() => {
    g.session = { ...SESSION }
  })

  it('re-dispara o pipeline pelo service role, nunca pela sessão do usuário', async () => {
    setup('error')
    const res = await call()

    expect(res.status).toBe(200)
    expect(g.admin.rpc).toHaveBeenCalledWith(
      'trigger_transcription_process',
      expect.objectContaining({ p_transcription_id: 't1' })
    )
    expect(g.supabase.rpc).not.toHaveBeenCalled()
  })

  it('não dispara nada quando a transcrição não está em erro', async () => {
    setup('draft_ready')
    const res = await call()

    expect(res.status).toBe(409)
    expect(g.admin.rpc).not.toHaveBeenCalled()
  })

  it('não dispara nada quando a transcrição não é da workspace', async () => {
    setup(null)
    const res = await call()

    expect(res.status).toBe(404)
    expect(g.admin.rpc).not.toHaveBeenCalled()
  })
})
