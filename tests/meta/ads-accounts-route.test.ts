import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner' as string, modules: [] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/api')>()
  return { ...actual, requireWorkspaceSession: async () => ({ session: g.session }) }
})

const getValidAdsToken = vi.hoisted(() => vi.fn())
const markAdsConnectionInvalid = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/ads-oauth', () => ({
  getValidAdsToken,
  markAdsConnectionInvalid,
}))

const graphFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/graph')>()
  return { ...actual, graphFetch }
})

import { GET, PUT } from '@/app/api/meta/ads/accounts/route'
import { MetaApiError } from '@/lib/meta/graph'

const getReq = () => new NextRequest('http://localhost/api/meta/ads/accounts')
const putReq = (body: unknown) =>
  new NextRequest('http://localhost/api/meta/ads/accounts', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  g.session = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: [] }
  g.supabase = createSupabaseMock()
  getValidAdsToken.mockReset()
  markAdsConnectionInvalid.mockReset()
  graphFetch.mockReset()
})

describe('GET /api/meta/ads/accounts', () => {
  it('lista as contas de anúncio do usuário conectado', async () => {
    getValidAdsToken.mockResolvedValue('tok123')
    graphFetch.mockResolvedValue({ data: [{ account_id: '111', name: 'Clínica A' }] })

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      adAccounts: [{ id: 'act_111', name: 'Clínica A' }],
    })
  })

  it('sem conexão devolve 409 pedindo pra conectar', async () => {
    getValidAdsToken.mockResolvedValue(null)

    const res = await GET(getReq())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/Conecte/)
  })

  it('token expirado (código 190) marca a conexão inválida e devolve 409', async () => {
    getValidAdsToken.mockResolvedValue('tok123')
    graphFetch.mockRejectedValue(new MetaApiError('expired', 190, null, 401))

    const res = await GET(getReq())

    expect(res.status).toBe(409)
    expect(markAdsConnectionInvalid).toHaveBeenCalledWith('acc1')
  })

  it('outro erro da Graph API devolve 502 sem marcar a conexão inválida', async () => {
    getValidAdsToken.mockResolvedValue('tok123')
    graphFetch.mockRejectedValue(new MetaApiError('boom', 1, null, 500))

    const res = await GET(getReq())

    expect(res.status).toBe(502)
    expect(markAdsConnectionInvalid).not.toHaveBeenCalled()
  })

  it('member recebe 403 e não chama a Graph API', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await GET(getReq())

    expect(res.status).toBe(403)
    expect(graphFetch).not.toHaveBeenCalled()
  })

  it('nunca inclui o token de acesso na resposta', async () => {
    getValidAdsToken.mockResolvedValue('super-secreto')
    graphFetch.mockResolvedValue({ data: [{ account_id: '111', name: 'Clínica A' }] })

    const res = await GET(getReq())
    const text = await res.text()

    expect(text).not.toContain('super-secreto')
  })
})

describe('PUT /api/meta/ads/accounts', () => {
  it('mapeia a unidade pra uma conta de anúncio', async () => {
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: { id: 'w1' }, error: null } },
    })

    const res = await PUT(putReq({ workspace_id: 'w1', ad_account_id: 'act_111', ad_account_name: 'Clínica A' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, adAccountId: 'act_111' })

    const workspaceSelect = g.supabase.callsTo('workspaces', 'select')[0]
    expect(workspaceSelect.filters).toContainEqual(['eq', 'id', 'w1'])
    expect(workspaceSelect.filters).toContainEqual(['eq', 'account_id', 'acc1'])

    const del = g.supabase.callsTo('workspace_ad_accounts', 'delete')[0]
    expect(del.filters).toContainEqual(['eq', 'workspace_id', 'w1'])

    const insert = g.supabase.callsTo('workspace_ad_accounts', 'insert')[0]
    expect(insert.payload).toEqual({
      workspace_id: 'w1',
      account_id: 'acc1',
      ad_account_id: 'act_111',
      ad_account_name: 'Clínica A',
    })
  })

  it('desvincula quando ad_account_id é null, sem inserir de novo', async () => {
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: { id: 'w1' }, error: null } },
    })

    const res = await PUT(putReq({ workspace_id: 'w1', ad_account_id: null }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, adAccountId: null })
    expect(g.supabase.callsTo('workspace_ad_accounts', 'delete')).toHaveLength(1)
    expect(g.supabase.callsTo('workspace_ad_accounts', 'insert')).toHaveLength(0)
  })

  it('unidade de outra account devolve 404 e não escreve nada', async () => {
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: null, error: null } },
    })

    const res = await PUT(putReq({ workspace_id: 'w-outra-account', ad_account_id: 'act_111' }))

    expect(res.status).toBe(404)
    expect(g.supabase.callsTo('workspace_ad_accounts', 'delete')).toHaveLength(0)
    expect(g.supabase.callsTo('workspace_ad_accounts', 'insert')).toHaveLength(0)
  })

  it('sem workspace_id devolve 400', async () => {
    const res = await PUT(putReq({ ad_account_id: 'act_111' }))
    expect(res.status).toBe(400)
  })

  it('member recebe 403 e não escreve nada', async () => {
    g.session = { ...g.session, role: 'member' }

    const res = await PUT(putReq({ workspace_id: 'w1', ad_account_id: 'act_111' }))

    expect(res.status).toBe(403)
    expect(g.supabase.callsTo('workspaces', 'select')).toHaveLength(0)
  })
})
