import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/email/mailer', () => ({ sendInviteEmail: async () => ({ sent: true }) }))

import { resolveActiveSession, resolveAccountWithoutWorkspace } from '@/lib/session/server'
import { POST as createAccount } from '@/app/api/admin/accounts/route'
import { POST as createWorkspace } from '@/app/api/workspaces/route'
import { POST as adminCreateWorkspace } from '@/app/api/admin/accounts/[id]/workspaces/route'

type Workspace = { id: string; name: string; is_default: boolean; is_active: boolean; display_order: number }

function setup(role: 'owner' | 'admin' | 'member', workspaces: Workspace[]) {
  g.supabase = createSupabaseMock({
    memberships: {
      select: {
        data: [
          {
            role,
            module_overrides: null,
            workspace_ids: null,
            account: { id: 'a1', name: 'Dr Eduardo', modules: [], is_active: true, workspaces },
          },
        ],
      },
    },
    profiles: { select: { data: { last_workspace_id: null } } },
    accounts: { insert: { data: { id: 'a1', name: 'Dr Eduardo' } } },
    workspaces: {
      insert: (call) => ({ data: { id: 'w1', ...(call.payload as Record<string, unknown>) } }),
      select: { count: workspaces.length },
    },
  })
  g.supabase.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'user1', email: 'x@y.com' } }, error: null })
  g.supabase.rpc.mockResolvedValue({ data: true, error: null })
}

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('conta nasce sem unidade de atendimento', () => {
  beforeEach(() => setup('owner', []))

  it('criar a conta não cria nenhuma unidade com o nome dela', async () => {
    const res = await createAccount(post('https://app.test/api/admin/accounts', { name: 'Dr Eduardo' }))
    expect(res.status).toBe(201)
    expect(g.supabase.callsTo('workspaces', 'insert')).toHaveLength(0)
  })

  it('sem unidade não há sessão ativa, mas a conta é reconhecida como pendente de configuração', async () => {
    expect(await resolveActiveSession()).toBeNull()
    expect(await resolveAccountWithoutWorkspace()).toEqual({ accountId: 'a1', accountName: 'Dr Eduardo', role: 'owner' })
  })

  it('conta que já tem unidade não é tratada como pendente', async () => {
    setup('owner', [{ id: 'w1', name: 'Centro', is_default: true, is_active: true, display_order: 0 }])
    expect(await resolveAccountWithoutWorkspace()).toBeNull()
    expect(await resolveActiveSession()).toMatchObject({ workspaceId: 'w1' })
  })

  it('owner cadastra a primeira unidade, que vira a padrão', async () => {
    const res = await createWorkspace(post('https://app.test/api/workspaces', { name: 'Consultório Centro' }))
    expect(res.status).toBe(201)
    expect(g.supabase.callsTo('workspaces', 'insert')[0].payload).toMatchObject({
      account_id: 'a1',
      name: 'Consultório Centro',
      is_default: true,
    })
  })

  it('membro comum não pode cadastrar a primeira unidade', async () => {
    setup('member', [])
    const res = await createWorkspace(post('https://app.test/api/workspaces', { name: 'Consultório Centro' }))
    expect(res.status).toBe(403)
    expect(g.supabase.callsTo('workspaces', 'insert')).toHaveLength(0)
  })

  it('unidades seguintes não roubam o padrão', async () => {
    setup('owner', [{ id: 'w1', name: 'Centro', is_default: true, is_active: true, display_order: 0 }])
    const res = await createWorkspace(post('https://app.test/api/workspaces', { name: 'Filial' }))
    expect(res.status).toBe(201)
    expect(g.supabase.callsTo('workspaces', 'insert')[0].payload).toMatchObject({ is_default: false })
  })

  it('admin MedScale: primeira unidade cadastrada para a conta vira a padrão', async () => {
    const res = await adminCreateWorkspace(post('https://app.test/api/admin/accounts/a1/workspaces', { name: 'Centro' }), {
      params: Promise.resolve({ id: 'a1' }),
    })
    expect(res?.status).toBe(201)
    expect(g.supabase.callsTo('workspaces', 'insert')[0].payload).toMatchObject({ is_default: true })
  })
})
