import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
  createBatches: vi.fn(),
  ensureGuide: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({
  trackBillingBatchDownloaded: vi.fn(),
  trackBillingBatchMarkedSent: vi.fn(),
  trackBillingBatchGenerated: vi.fn(),
  trackBillingGuideCreated: vi.fn(),
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
vi.mock('@/lib/billing/batches', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/batches')>()),
  createBatchesForInsurer: g.createBatches,
}))
vi.mock('@/lib/billing/guides', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/guides')>()),
  ensureGuideSafely: g.ensureGuide,
}))

import { GET as listGuides } from '@/app/api/billing/guides/route'
import { GET as listInsurers, POST as createInsurer } from '@/app/api/billing/insurers/route'
import { GET as listBatches, POST as generateBatch } from '@/app/api/billing/batches/route'
import { GET as download } from '@/app/api/billing/batches/[id]/download/route'
import { POST as markSent } from '@/app/api/billing/batches/[id]/sent/route'
import { POST as cron } from '@/app/api/cron/tiss-batches/route'

const OWNER = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: ['billing'] }

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ accounts: { select: { data: { modules: ['billing'] } } }, ...config })
  return g.supabase
}

const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as never)
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('acesso às rotas /api/billing', () => {
  beforeEach(() => {
    g.session = { ...OWNER }
    setup()
  })

  it('member deve receber 403 em /api/billing/guides', async () => {
    g.session = { ...OWNER, role: 'member' }
    const res = await listGuides(req('/api/billing/guides'))
    expect(res.status).toBe(403)
    expect(g.supabase.callsTo('tiss_guides')).toHaveLength(0)
  })

  it('member pode listar operadoras para o seletor da agenda (só ativas)', async () => {
    g.session = { ...OWNER, role: 'member' }
    setup({ health_insurers: { select: { data: [{ id: 'ins1', name: 'Op' }] } } })

    const res = await listInsurers(req('/api/billing/insurers?all=1'))

    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('health_insurers', 'select')
    expect(call.filters).toContainEqual(['eq', 'is_active', true])
  })

  it('deve responder 403 com o módulo billing inativo na account', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } } })
    expect((await listInsurers(req('/api/billing/insurers'))).status).toBe(403)
    expect((await listGuides(req('/api/billing/guides'))).status).toBe(403)
  })

  it('member não pode cadastrar operadora', async () => {
    g.session = { ...OWNER, role: 'member' }
    const res = await createInsurer(req('/api/billing/insurers', json({ name: 'X', ans_registry: '123456', provider_code: 'P' })))
    expect(res.status).toBe(403)
  })

  it('cadastro com registro ANS de 5 dígitos deve dar erro de validação', async () => {
    const res = await createInsurer(req('/api/billing/insurers', json({ name: 'X', ans_registry: '12345', provider_code: 'P' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/6 dígitos/)
    expect(g.supabase.callsTo('health_insurers', 'insert')).toHaveLength(0)
  })

  it('lista de guias aplica filtros e fica presa à account', async () => {
    setup({ tiss_guides: { select: { data: [], count: 0 } } })
    const res = await listGuides(req('/api/billing/guides?status=draft,bogus&insurer_id=ins1&from=2026-09-01&to=2026-09-30'))

    expect(res.status).toBe(200)
    const [call] = g.supabase.callsTo('tiss_guides', 'select')
    expect(call.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', 'acc1'],
        ['in', 'status', ['draft']],
        ['eq', 'insurer_id', 'ins1'],
        ['gte', 'service_date', '2026-09-01'],
        ['lte', 'service_date', '2026-09-30'],
      ]),
    )
  })
})

describe('lotes', () => {
  beforeEach(() => {
    g.session = { ...OWNER }
    setup()
  })

  it('a lista de lotes nunca deve pedir xml_path', async () => {
    setup({ tiss_batches: { select: { data: [] } } })
    await listBatches(req('/api/billing/batches'))
    const [call] = g.supabase.callsTo('tiss_batches', 'select')
    expect(String(call.filters.find((f) => f[0] === 'select')?.[1])).not.toContain('xml_path')
  })

  it('download devolve só a URL assinada de 5 minutos, sem o caminho do arquivo', async () => {
    setup({ tiss_batches: { select: { data: { xml_path: 'acc1/ins1/7.xml', batch_number: 7, status: 'generated' } } } })

    const res = await download(req('/api/billing/batches/b1/download'), { params: Promise.resolve({ id: 'b1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Object.keys(body)).toEqual(['url'])
    expect(JSON.stringify(body)).not.toContain('acc1/ins1/7.xml')
    expect(g.supabase.storage.createSignedUrl).toHaveBeenCalledWith('acc1/ins1/7.xml', 300, { download: 'lote-tiss-7.xml' })
  })

  it('member não baixa XML', async () => {
    g.session = { ...OWNER, role: 'member' }
    const res = await download(req('/api/billing/batches/b1/download'), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(403)
    expect(g.supabase.storage.createSignedUrl).not.toHaveBeenCalled()
  })

  it('"Gerar lote agora" usa a operadora da account e registra o autor', async () => {
    setup({ health_insurers: { select: { data: { id: 'ins1', account_id: 'acc1', tiss_version: '4.03.00' } } } })
    g.createBatches.mockResolvedValue([{ status: 'generated', batchId: 'b1', batchNumber: 1, guideCount: 3 }])

    const res = await generateBatch(req('/api/billing/batches', json({ insurer_id: 'ins1' })))

    expect(res.status).toBe(200)
    expect(g.createBatches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'ins1' }), expect.objectContaining({ createdBy: 'u1' }))
    const [call] = g.supabase.callsTo('health_insurers', 'select')
    expect(call.filters).toContainEqual(['eq', 'account_id', 'acc1'])
  })

  it('marcar como enviado usa a função transacional com o client do usuário', async () => {
    setup({ tiss_batches: { select: { data: { id: 'b1', status: 'generated' } } } })
    g.supabase.rpc.mockResolvedValue({ data: true, error: null })

    const res = await markSent(req('/api/billing/batches/b1/sent', { method: 'POST' }), { params: Promise.resolve({ id: 'b1' }) })

    expect(res.status).toBe(200)
    expect(g.supabase.rpc).toHaveBeenCalledWith('mark_tiss_batch_sent', { p_batch_id: 'b1' })
  })

  it('lote já enviado ou com erro não pode ser marcado de novo', async () => {
    setup({ tiss_batches: { select: { data: { id: 'b1', status: 'sent' } } } })
    g.supabase.rpc.mockResolvedValue({ data: false, error: null })
    const res = await markSent(req('/api/billing/batches/b1/sent', { method: 'POST' }), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(409)
  })
})

describe('cron /api/cron/tiss-batches', () => {
  const cronReq = () =>
    req('/api/cron/tiss-batches', { method: 'POST', headers: { authorization: 'Bearer cron-secret-test' } })

  // Terça 29/09/2026 21:10 UTC = 18:10 em São Paulo.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T21:10:00Z'))
  })

  const insurer = {
    id: 'ins1',
    account_id: 'acc1',
    ans_registry: '999999',
    provider_code: 'P1',
    tiss_version: '4.03.00',
    max_guides_per_batch: 100,
    batch_weekdays: [1, 2, 3, 4, 5],
    batch_hour: 18,
    is_active: true,
  }

  it('deve recusar chamada sem o CRON_SECRET', async () => {
    const res = await cron(req('/api/cron/tiss-batches', { method: 'POST' }))
    expect(res.status).toBe(401)
    vi.useRealTimers()
  })

  it('deve criar guias faltando e gerar lote da operadora no horário', async () => {
    setup({
      accounts: { select: { data: [{ id: 'acc1' }] } },
      appointments: { select: { data: [{ id: 'ap1' }, { id: 'ap2' }] } },
      tiss_guides: { select: { data: [{ appointment_id: 'ap1' }] } },
      health_insurers: { select: { data: [insurer, { ...insurer, id: 'ins2', batch_hour: 9 }] } },
      tiss_batches: { select: { data: [] } },
    })
    g.createBatches.mockResolvedValue([{ status: 'generated', batchId: 'b1', batchNumber: 1, guideCount: 2 }])

    const res = await cron(cronReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(g.ensureGuide).toHaveBeenCalledTimes(1)
    expect(g.ensureGuide).toHaveBeenCalledWith('ap2', expect.anything())
    expect(g.createBatches).toHaveBeenCalledTimes(1)
    expect(g.createBatches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'ins1' }), expect.objectContaining({ createdBy: null }))
    expect(body.batches).toEqual([{ insurerId: 'ins1', result: 'generated', guides: 2 }])
    vi.useRealTimers()
  })

  it('rodar de novo na mesma hora não gera lote duplicado', async () => {
    setup({
      accounts: { select: { data: [{ id: 'acc1' }] } },
      appointments: { select: { data: [] } },
      health_insurers: { select: { data: [insurer] } },
      tiss_batches: { select: { data: [{ id: 'recent' }] } },
    })

    const body = await (await cron(cronReq())).json()

    expect(g.createBatches).not.toHaveBeenCalled()
    expect(body.batches).toEqual([{ insurerId: 'ins1', result: 'already_ran' }])
    const [guard] = g.supabase.callsTo('tiss_batches', 'select')
    expect(guard.filters).toContainEqual(['is', 'created_by', null])
    vi.useRealTimers()
  })

  it('não deve fazer nada sem accounts com o módulo', async () => {
    setup({ accounts: { select: { data: [] } } })
    const body = await (await cron(cronReq())).json()
    expect(body).toEqual({ accounts: 0, guidesSwept: 0, batches: [] })
    expect(g.supabase.callsTo('appointments')).toHaveLength(0)
    vi.useRealTimers()
  })
})
