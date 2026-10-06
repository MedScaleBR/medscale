import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import { AUTH_SOURCES } from '../tiss/authorization-fixtures'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  // Rotas de autorização nunca usam service role.
  createAdminClient: () => { throw new Error('service client em rota de usuário') },
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireRole: (session: { role: string }, roles: string[]) =>
      roles.includes(session.role) ? null : NR.json({ error: 'forbidden' }, { status: 403 }),
  }
})

import { GET as list, POST as create } from '@/app/api/billing/authorizations/route'
import { GET as professionals } from '@/app/api/billing/authorizations/professionals/route'

const ADMIN = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'admin', modules: ['billing'] }
const AT = '2026-10-05T13:00:00.123456+00:00'
const APPOINTMENT = '30000000-0000-0000-0000-000000000001'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ accounts: { select: { data: { modules: ['billing'] } } }, ...config })
  return g.supabase
}
const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as never)
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('GET/POST /api/billing/authorizations', () => {
  beforeEach(() => {
    g.session = { ...ADMIN }
    setup()
  })

  it('member recebe 403 em todas as rotas desta tarefa, sem consultar tabela nem RPC (P1/P2)', async () => {
    g.session = { ...ADMIN, role: 'member' }
    const uuid = '40000000-0000-0000-0000-000000000001'
    expect((await list(req('/api/billing/authorizations'))).status).toBe(403)
    expect((await create(req('/api/billing/authorizations', json({ type: 'sp_sadt_request', appointment_id: uuid })))).status).toBe(403)
    expect((await professionals(req('/api/billing/authorizations/professionals'))).status).toBe(403)
    expect(g.supabase.callsTo('tiss_authorizations')).toHaveLength(0)
    expect(g.supabase.callsTo('appointments')).toHaveLength(0)
    expect(g.supabase.rpc).not.toHaveBeenCalled()
  })

  it('admin lista com filtros, presa à account', async () => {
    setup({ tiss_authorizations: { select: { data: [], count: 0 } } })
    const uuid = '40000000-0000-0000-0000-000000000001'
    const res = await list(req(`/api/billing/authorizations?status=draft,bogus&type=opme_request&insurer_id=${uuid}&patient_id=${uuid}&professional_id=${uuid}&from=2026-10-01&to=2026-10-31`))
    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('tiss_authorizations', 'select')
    expect(call.filters).toEqual(expect.arrayContaining([
      ['eq', 'account_id', 'acc1'],
      ['in', 'status', ['draft']],
      ['eq', 'type', 'opme_request'],
      ['eq', 'insurer_id', uuid],
      ['eq', 'patient_id', uuid],
      ['filter', 'payload->professional->>id', 'eq', uuid],
      ['gte', 'requested_at', '2026-10-01'],
      ['lte', 'requested_at', '2026-10-31'],
    ]))
  })

  it('account sem o módulo billing recebe 403 sem consultar autorizações', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } } })
    expect((await list(req('/api/billing/authorizations'))).status).toBe(403)
    expect(g.supabase.callsTo('tiss_authorizations')).toHaveLength(0)
  })

  it('admin cria a partir do agendamento: RPC com snapshot, pendências e item TUSS; sem tocar em guias', async () => {
    setup({
      appointments: { select: { data: { id: APPOINTMENT, workspace_id: 'w2', patient_id: 'pa1', doctor_id: 'p1', insurer_id: 'in1', patient_insurance_id: 'pi1', insurer_procedure_id: 'pr1' } } },
      insurer_procedures: { select: { data: { tuss_code: '40301630', description: 'Hemograma' } } },
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    g.supabase.rpc.mockImplementation(async (fn: string) =>
      fn === 'tiss_authorization_professionals'
        ? { data: [AUTH_SOURCES.professional], error: null }
        : { data: { id: 'a1', status: 'ready', provider_guide_number: '41' }, error: null })

    const res = await create(req('/api/billing/authorizations', json({ type: 'sp_sadt_request', appointment_id: APPOINTMENT })))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'a1', status: 'ready', provider_guide_number: '41' })
    const [, args] = g.supabase.rpc.mock.calls.find(([fn]) => fn === 'create_tiss_authorization') ?? []
    expect(args).toMatchObject({
      p_workspace_id: 'w2', p_patient_id: 'pa1', p_insurer_id: 'in1', p_type: 'sp_sadt_request',
      p_appointment_id: APPOINTMENT, p_parent_id: null, p_missing_fields: [],
      p_items: [expect.objectContaining({ table_code: '22', code: '40301630' })],
      p_payload: expect.objectContaining({ type: 'sp_sadt_request', professional: expect.objectContaining({ id: 'p1' }) }),
    })
    expect(g.supabase.callsTo('tiss_guides')).toHaveLength(0)
  })

  it('corpo inválido → 400; erro do RPC vira mensagem fixa', async () => {
    expect((await create(req('/api/billing/authorizations', json({ type: 'opme_request' })))).status).toBe(400)
    setup({
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    g.supabase.rpc.mockImplementation(async (fn: string) =>
      fn === 'tiss_authorization_professionals' ? { data: [], error: null } : { data: null, error: { message: 'tiss_authorization_forbidden', code: '42501' } })
    const uuid = '40000000-0000-0000-0000-000000000001'
    const res = await create(req('/api/billing/authorizations', json({ type: 'hospitalization_request', patient_id: uuid, insurer_id: uuid })))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Sem permissão para esta ação.' })
  })

  it('lista profissionais da account pelo RPC, no workspace da sessão', async () => {
    g.supabase.rpc.mockResolvedValue({ data: [AUTH_SOURCES.professional], error: null })
    const res = await professionals(req('/api/billing/authorizations/professionals'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ professionals: [AUTH_SOURCES.professional] })
    expect(g.supabase.rpc).toHaveBeenCalledWith('tiss_authorization_professionals', { p_workspace_id: 'w1' })
  })
})
