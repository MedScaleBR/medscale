import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type RecordedCall, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import { AUTH_SOURCES, fakeSpSadtRequest, procedureItem } from '../tiss/authorization-fixtures'

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
import { GET as detail, PATCH as patch } from '@/app/api/billing/authorizations/[id]/route'
import { PUT as putItems } from '@/app/api/billing/authorizations/[id]/items/route'
import { POST as transition } from '@/app/api/billing/authorizations/[id]/transitions/route'
import { POST as respond } from '@/app/api/billing/authorizations/[id]/response/route'
import { GET as events } from '@/app/api/billing/authorizations/[id]/events/route'
import { GET as xml } from '@/app/api/billing/authorizations/[id]/xml/route'

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

  it('page vira inteiro entre 1 e 10000 (NaN, fração e excesso)', async () => {
    setup({ tiss_authorizations: { select: { data: [], count: 0 } } })
    const pageOf = async (q: string) => (await (await list(req(`/api/billing/authorizations${q}`))).json()).page
    expect(await pageOf('?page=abc')).toBe(1)
    expect(await pageOf('?page=-3')).toBe(1)
    expect(await pageOf('?page=2.9')).toBe(2)
    expect(await pageOf('?page=99999999')).toBe(10000)
  })

  it('from/to que não são datas reais → 400 sem consultar', async () => {
    setup({ tiss_authorizations: { select: { data: [], count: 0 } } })
    expect((await list(req('/api/billing/authorizations?from=2026-99-99'))).status).toBe(400)
    expect((await list(req('/api/billing/authorizations?to=2026-02-30'))).status).toBe(400)
    expect(g.supabase.callsTo('tiss_authorizations')).toHaveLength(0)
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

function authorizationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', workspace_id: 'w1', patient_id: 'pa1', insurer_id: 'in1', appointment_id: null, parent_id: null,
    type: 'sp_sadt_request', status: 'ready', provider_guide_number: '41', missing_fields: [], requested_at: '2026-10-05',
    updated_at: AT, payload: fakeSpSadtRequest(1).payload, ...over,
  }
}
function detailMock(row = authorizationRow(), extra: SupabaseMockConfig = {}) {
  const m = setup({
    tiss_authorizations: { select: (call: RecordedCall) => (filterValue(call, 'eq', 'parent_id') ? { data: [] } : { data: row }) },
    tiss_authorization_items: { select: { data: [procedureItem(1)] } },
    ...extra,
  })
  m.rpc.mockImplementation(async (fn: string) =>
    fn === 'tiss_authorization_professionals' ? { data: [AUTH_SOURCES.professional], error: null } : { data: { id: 'a1' }, error: null })
  return m
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const rpcArgs = (fn: string) => g.supabase.rpc.mock.calls.find(([name]) => name === fn)?.[1]

describe('detalhe, conteúdo e itens', () => {
  beforeEach(() => { g.session = { ...ADMIN } })

  it('detalhe traz itens, pai e filhos; 404 fora da account', async () => {
    detailMock()
    const res = await detail(req('/api/billing/authorizations/a1'), ctx('a1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authorization: { id: 'a1' }, items: [{ id: 'i1' }], parent: null, children: [] })
    setup({ tiss_authorizations: { select: { data: null } } })
    expect((await detail(req('/api/billing/authorizations/x'), ctx('x'))).status).toBe(404)
  })

  it('edita o pedido repassando expected_updated_at como string e recalculando pendências', async () => {
    detailMock()
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, request: { observation: 'Em jejum' } }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(200)
    expect(rpcArgs('update_tiss_authorization')).toMatchObject({
      p_id: 'a1', p_expected_updated_at: AT, p_missing_fields: [], p_event: 'updated', p_requested_at: null,
      p_payload: expect.objectContaining({ request: expect.objectContaining({ observation: 'Em jejum' }) }),
    })
  })

  it('autorização enviada é somente leitura (409 sem RPC)', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, card_number: 'X' }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(409)
    expect(rpcArgs('update_tiss_authorization')).toBeUndefined()
  })

  it('"Recarregar dados" relê configurações, preserva o pedido e grava evento refreshed', async () => {
    detailMock(authorizationRow(), {
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: { ...AUTH_SOURCES.workspace, legal_name: 'Razão Nova' } } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    await patch(req('/api/billing/authorizations/a1', json({ action: 'refresh', expected_updated_at: AT }, 'PATCH')), ctx('a1'))
    const args = rpcArgs('update_tiss_authorization') as { p_event: string; p_payload: { provider: { legal_name: string }; request: { clinical_indication: string } } }
    expect(args.p_event).toBe('refreshed')
    expect(args.p_payload.provider.legal_name).toBe('Razão Nova')
    expect(args.p_payload.request.clinical_indication).toBe('Investigação de anemia')
  })

  it('profissional fora da lista (sem CRM) → 400', async () => {
    detailMock(authorizationRow(), {
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    const other = '40000000-0000-0000-0000-000000000009'
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, professional_id: other }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(400)
  })

  it('conflito de edição vira 409 com mensagem fixa', async () => {
    const m = detailMock()
    m.rpc.mockImplementation(async () => ({ data: null, error: { message: 'tiss_authorization_changed' } }))
    const res = await patch(req('/api/billing/authorizations/a1', json({ expected_updated_at: AT, newborn: true }, 'PATCH')), ctx('a1'))
    expect(res.status).toBe(409)
  })

  it('troca de itens em autorização enviada → 409 sem RPC', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const res = await putItems(req('/api/billing/authorizations/a1/items', json({ expected_updated_at: AT, items: [] }, 'PUT')), ctx('a1'))
    expect(res.status).toBe(409)
    expect(rpcArgs('update_tiss_authorization')).toBeUndefined()
  })

  it('substitui itens validados; OPME sem opção de fabricante → 400', async () => {
    detailMock()
    const items = [{ table_code: '22', code: '40301630', description: 'Hemograma', quantity_requested: 1 }, { table_code: '22', code: '40302040', description: 'Glicose', quantity_requested: 2 }]
    const ok = await putItems(req('/api/billing/authorizations/a1/items', json({ expected_updated_at: AT, items }, 'PUT')), ctx('a1'))
    expect(ok.status).toBe(200)
    expect(rpcArgs('update_tiss_authorization')).toMatchObject({ p_items: [expect.objectContaining({ code: '40301630' }), expect.objectContaining({ code: '40302040', quantity_requested: 2 })] })
    detailMock(authorizationRow({ type: 'opme_request', payload: { ...fakeSpSadtRequest(1).payload, type: 'opme_request', request: { technical_justification: 'x', material_specification: null, observation: null } } }))
    const bad = await putItems(req('/api/billing/authorizations/a1/items', json({ expected_updated_at: AT, items: [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 1 }] }, 'PUT')), ctx('a1'))
    expect(bad.status).toBe(400)
  })
})

describe('status, resposta, histórico e XML', () => {
  beforeEach(() => { g.session = { ...ADMIN } })

  it('admin marca como enviada a partir de ready', async () => {
    detailMock()
    const res = await transition(req('/api/billing/authorizations/a1/transitions', json({ to: 'sent', expected_updated_at: AT })), ctx('a1'))
    expect(res.status).toBe(200)
    expect(rpcArgs('transition_tiss_authorization')).toEqual({ p_id: 'a1', p_to: 'sent', p_expected_updated_at: AT })
  })

  it('member não opera status, resposta, histórico nem XML (403 sem leitura nem RPC)', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    g.session = { ...ADMIN, role: 'member' }
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(403)
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1' })), ctx('a1'))).status).toBe(403)
    expect((await events(req('/x'), ctx('a1'))).status).toBe(403)
    expect((await xml(req('/x'), ctx('a1'))).status).toBe(403)
    expect(g.supabase.callsTo('tiss_authorizations')).toHaveLength(0)
    expect(g.supabase.callsTo('tiss_authorization_events')).toHaveLength(0)
    expect(g.supabase.rpc).not.toHaveBeenCalled()
  })

  it('owner cancela depois do envio; estado final → 409 sem RPC', async () => {
    g.session = { ...ADMIN, role: 'owner' }
    detailMock(authorizationRow({ status: 'sent' }))
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(200)
    detailMock(authorizationRow({ status: 'authorized' }))
    expect((await transition(req('/x', json({ to: 'cancelled', expected_updated_at: AT })), ctx('a1'))).status).toBe(409)
    expect(rpcArgs('transition_tiss_authorization')).toBeUndefined()
  })

  it('transição: destino inválido ou sem expected_updated_at → 400; enviar fora de ready → 409 sem RPC; conflito do RPC → 409', async () => {
    detailMock()
    expect((await transition(req('/x', json({ to: 'authorized', expected_updated_at: AT })), ctx('a1'))).status).toBe(400)
    expect((await transition(req('/x', json({ to: 'sent' })), ctx('a1'))).status).toBe(400)
    detailMock(authorizationRow({ status: 'sent' }))
    expect((await transition(req('/x', json({ to: 'sent', expected_updated_at: AT })), ctx('a1'))).status).toBe(409)
    expect(rpcArgs('transition_tiss_authorization')).toBeUndefined()
    const m = detailMock()
    m.rpc.mockImplementation(async () => ({ data: null, error: { message: 'tiss_authorization_changed' } }))
    expect((await transition(req('/x', json({ to: 'sent', expected_updated_at: AT })), ctx('a1'))).status).toBe(409)
  })

  it('resposta: admin registra com itens; código 6 vale; correção em estado final (R1); antes do envio ou cancelada → 409', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const ok = await respond(req('/x', json({ expected_updated_at: AT, status_code: '1', operator_guide_number: 'OP1', password: 'S1',
      authorization_date: '2026-10-06', password_valid_until: '2026-11-05', items: [{ id: 'i1', quantity_authorized: 1, authorized_value_cents: null }] })), ctx('a1'))
    expect(ok.status).toBe(200)
    expect(rpcArgs('record_tiss_authorization_response')).toEqual({
      p_id: 'a1', p_expected_updated_at: AT, p_status_code: '1', p_operator_guide_number: 'OP1', p_password: 'S1',
      p_authorization_date: '2026-10-06', p_password_valid_until: '2026-11-05',
      p_items: [{ id: 'i1', quantity_authorized: 1, authorized_value_cents: null }],
    })
    detailMock(authorizationRow({ status: 'sent' }))
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '6' })), ctx('a1'))).status).toBe(200)
    detailMock(authorizationRow({ status: 'partially_authorized' }))
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1' })), ctx('a1'))).status).toBe(200)
    for (const status of ['draft', 'ready', 'cancelled']) {
      detailMock(authorizationRow({ status }))
      expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1' })), ctx('a1'))).status).toBe(409)
      expect(rpcArgs('record_tiss_authorization_response')).toBeUndefined()
    }
  })

  it('resposta: item de outra autorização, valor em procedimento e quantidade acima da solicitada → 400 sem RPC', async () => {
    const bodies = [
      { items: [{ id: 'outro', quantity_authorized: 1, authorized_value_cents: null }] },
      { items: [{ id: 'i1', quantity_authorized: 1, authorized_value_cents: 5000 }] },
      { items: [{ id: 'i1', quantity_authorized: 2, authorized_value_cents: null }] },
    ]
    for (const extra of bodies) {
      detailMock(authorizationRow({ status: 'sent' }))
      const res = await respond(req('/x', json({ expected_updated_at: AT, status_code: '1', ...extra })), ctx('a1'))
      expect(res.status).toBe(400)
      expect(rpcArgs('record_tiss_authorization_response')).toBeUndefined()
    }
  })

  it('resposta: item repetido ou sem as duas chaves → 400; autorização fora da account → 404', async () => {
    detailMock(authorizationRow({ status: 'sent' }))
    const dup = { id: 'i1', quantity_authorized: 1, authorized_value_cents: null }
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1', items: [dup, dup] })), ctx('a1'))).status).toBe(400)
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1', items: [{ id: 'i1', quantity_authorized: 1 }] })), ctx('a1'))).status).toBe(400)
    setup({ tiss_authorizations: { select: { data: null } } })
    expect((await respond(req('/x', json({ expected_updated_at: AT, status_code: '1' })), ctx('x'))).status).toBe(404)
  })

  it('histórico em ordem de gravação, preso à account', async () => {
    setup({ tiss_authorization_events: { select: { data: [{ id: 1, event: 'created' }, { id: 2, event: 'ready' }] } } })
    const res = await events(req('/x'), ctx('a1'))
    expect(await res.json()).toEqual({ events: [{ id: 1, event: 'created' }, { id: 2, event: 'ready' }] })
    const [call] = g.supabase.callsTo('tiss_authorization_events', 'select')
    expect(call.filters).toEqual(expect.arrayContaining([['eq', 'authorization_id', 'a1'], ['eq', 'account_id', 'acc1'], ['order', 'id', { ascending: true }]]))
  })

  it('XML: rascunho → 409 JSON; pronta → arquivo ISO-8859-1 com nome e evento registrado', async () => {
    detailMock(authorizationRow({ status: 'draft', missing_fields: ['items'] }))
    expect((await xml(req('/x'), ctx('a1'))).status).toBe(409)
    detailMock()
    const res = await xml(req('/x'), ctx('a1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/xml; charset=ISO-8859-1')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="solicitacao-sp-sadt-41.xml"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(body.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true)
    expect(body).toContain('<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>')
    expect(rpcArgs('log_tiss_authorization_xml')).toMatchObject({ p_id: 'a1', p_hash: expect.stringMatching(/^[a-f0-9]{32}$/) })
  })

  it('XML: autorização inexistente → 404', async () => {
    setup({ tiss_authorizations: { select: { data: null } } })
    expect((await xml(req('/x'), ctx('x'))).status).toBe(404)
  })
})
