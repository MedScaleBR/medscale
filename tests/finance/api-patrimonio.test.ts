import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

// Rotas de patrimônio: guarda owner-only (a camada de API das três exigidas —
// RLS, API e UI) e as regras que não dá para checar só com o tipo.

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, role: 'owner' as string }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'a1', workspaceId: 'w1', role: g.role, modules: ['finance'] },
  }),
  requireModule: () => null,
  requireRole: (s: { role: string }, roles: string[]) =>
    roles.includes(s.role) ? null : new Response(JSON.stringify({ error: 'nope' }), { status: 403 }),
}))

import * as reservas from '@/app/api/finance/reservas/route'
import * as reservaId from '@/app/api/finance/reservas/[id]/route'
import * as movimentos from '@/app/api/finance/reservas/[id]/movimentos/route'
import * as investimentos from '@/app/api/finance/investimentos/route'
import * as investimentoId from '@/app/api/finance/investimentos/[id]/route'
import * as projecoes from '@/app/api/finance/projecoes/route'
import * as metas from '@/app/api/finance/metas/route'
import * as metaId from '@/app/api/finance/metas/[id]/route'
import * as sugestoes from '@/app/api/finance/sugestoes/route'
import * as dismiss from '@/app/api/finance/sugestoes/dismiss/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

// NextRequest e não Request: as rotas leem query string por `req.nextUrl`.
function req(body?: unknown, url = 'https://app.test/api/finance/x', method = 'POST') {
  return new NextRequest(
    url,
    body === undefined
      ? { method: method === 'POST' ? 'GET' : method }
      : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
  ) as never
}

const RESERVE = {
  id: 'res1', account_id: 'a1', kind: 'pf', name: 'Emergência', archived_at: null, created_at: '',
}
const CAT_PF_OUT = {
  id: 'c1', account_id: 'a1', kind: 'pf', direction: 'out', parent_id: null,
  name: 'Lazer', sort_order: 0, is_archived: false, is_essential: false, created_at: '',
}
const CAT_PF_IN = {
  id: 'c2', account_id: 'a1', kind: 'pf', direction: 'in', parent_id: null,
  name: 'Salário', sort_order: 1, is_archived: false, is_essential: true, created_at: '',
}

beforeEach(() => {
  g.role = 'owner'
  g.supabase = createSupabaseMock()
})

// A lista abaixo é a checagem pedida: admin (e member) não passam em NENHUMA
// rota nova, mesmo com o módulo 'finance' ativo na conta.
describe('guarda owner-only', () => {
  const handlers: Array<[string, () => Promise<Response>]> = [
    ['GET /reservas', () => reservas.GET(req() as never)],
    ['POST /reservas', () => reservas.POST(req({ name: 'x' }) as never)],
    ['PATCH /reservas/[id]', () => reservaId.PATCH(req({ name: 'y' }, undefined, 'PATCH') as never, params('res1') as never)],
    ['DELETE /reservas/[id]', () => reservaId.DELETE(req(undefined, undefined, 'DELETE') as never, params('res1') as never)],
    ['POST /reservas/[id]/movimentos', () => movimentos.POST(req({ amount: 10 }) as never, params('res1') as never)],
    ['DELETE /reservas/[id]/movimentos', () => movimentos.DELETE(req(undefined, 'https://app.test/x?movimento=m1', 'DELETE') as never, params('res1') as never)],
    ['GET /investimentos', () => investimentos.GET(req() as never)],
    ['POST /investimentos', () => investimentos.POST(req({ name: 'CDB', type: 'renda_fixa', invested_amount: 1000 }) as never)],
    ['PATCH /investimentos/[id]', () => investimentoId.PATCH(req({ current_value: 1 }, undefined, 'PATCH') as never, params('i1') as never)],
    ['DELETE /investimentos/[id]', () => investimentoId.DELETE(req(undefined, undefined, 'DELETE') as never, params('i1') as never)],
    ['GET /projecoes', () => projecoes.GET(req() as never)],
    ['PUT /projecoes', () => projecoes.PUT(req({ category_id: 'c1', period_month: '2026-09', projected_amount: 1 }, undefined, 'PUT') as never)],
    ['DELETE /projecoes', () => projecoes.DELETE(req(undefined, 'https://app.test/x?id=p1', 'DELETE') as never)],
    ['GET /metas', () => metas.GET(req() as never)],
    ['POST /metas', () => metas.POST(req({ name: 'Viagem', target_amount: 100 }) as never)],
    ['PATCH /metas/[id]', () => metaId.PATCH(req({ name: 'Viagem' }, undefined, 'PATCH') as never, params('g1') as never)],
    ['DELETE /metas/[id]', () => metaId.DELETE(req(undefined, undefined, 'DELETE') as never, params('g1') as never)],
    ['GET /sugestoes', () => sugestoes.GET(req() as never)],
    ['PUT /sugestoes', () => sugestoes.PUT(req({ projection_tolerance_pct: 0, history_tolerance_pct: 30 }, undefined, 'PUT') as never)],
    ['POST /sugestoes/dismiss', () => dismiss.POST(req({ category_id: 'c1', period_month: '2026-09' }) as never)],
    ['DELETE /sugestoes/dismiss', () => dismiss.DELETE(req(undefined, 'https://app.test/x?category_id=c1&periodo=2026-09', 'DELETE') as never)],
  ]

  for (const role of ['admin', 'member']) {
    for (const [label, call] of handlers) {
      it(`403 para ${role} em ${label}`, async () => {
        g.role = role
        const res = await call()
        expect(res.status).toBe(403)
      })
    }
  }
})

describe('reservas', () => {
  it('devolve saldo somado dos movimentos', async () => {
    g.supabase = createSupabaseMock({
      finance_reserves: { select: { data: [RESERVE] } },
      finance_reserve_movements: {
        select: { data: [
          { id: 'm1', reserve_id: 'res1', account_id: 'a1', amount: 500, type: 'deposit', source: 'web', note: null, occurred_at: '2026-09-01', created_at: '' },
          { id: 'm2', reserve_id: 'res1', account_id: 'a1', amount: 200, type: 'withdrawal', source: 'web', note: null, occurred_at: '2026-09-05', created_at: '' },
        ] },
      },
    })
    const res = await reservas.GET(req() as never)
    const json = await res.json()
    expect(json.reserves[0].balance).toBe(300)
  })

  it('409 name_taken quando o nome já existe', async () => {
    g.supabase = createSupabaseMock({
      finance_reserves: { insert: { error: { code: '23505', message: 'dup' } } },
    })
    const res = await reservas.POST(req({ name: 'Emergência' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('name_taken')
  })

  it('409 ao excluir reserva com movimentos — arquivar é o caminho', async () => {
    g.supabase = createSupabaseMock({
      finance_reserves: { select: { data: { id: 'res1' } } },
      finance_reserve_movements: { select: { count: 3 } },
    })
    const res = await reservaId.DELETE(req(undefined, undefined, 'DELETE') as never, params('res1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('has_movements')
  })

  it('arquivar grava archived_at; desarquivar limpa', async () => {
    g.supabase = createSupabaseMock({ finance_reserves: { select: { data: { id: 'res1' } } } })
    await reservaId.PATCH(req({ archived: true }, undefined, 'PATCH') as never, params('res1') as never)
    const arquivar = g.supabase.callsTo('finance_reserves', 'update')[0].payload as Record<string, unknown>
    expect(arquivar.archived_at).toBeTruthy()

    g.supabase = createSupabaseMock({ finance_reserves: { select: { data: { id: 'res1' } } } })
    await reservaId.PATCH(req({ archived: false }, undefined, 'PATCH') as never, params('res1') as never)
    const desarquivar = g.supabase.callsTo('finance_reserves', 'update')[0].payload as Record<string, unknown>
    expect(desarquivar.archived_at).toBeNull()
  })
})

describe('movimentos', () => {
  it('404 quando a reserva não é da conta', async () => {
    g.supabase = createSupabaseMock({ finance_reserves: { select: { data: null } } })
    const res = await movimentos.POST(req({ amount: 100 }) as never, params('outra') as never)
    expect(res.status).toBe(404)
  })

  it('409 em reserva arquivada', async () => {
    g.supabase = createSupabaseMock({
      finance_reserves: { select: { data: { id: 'res1', archived_at: '2026-01-01T00:00:00Z' } } },
    })
    const res = await movimentos.POST(req({ amount: 100 }) as never, params('res1') as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('reserve_archived')
  })

  it('400 para valor não positivo', async () => {
    g.supabase = createSupabaseMock({ finance_reserves: { select: { data: { id: 'res1', archived_at: null } } } })
    const res = await movimentos.POST(req({ amount: -5 }) as never, params('res1') as never)
    expect(res.status).toBe(400)
  })

  it('grava retirada com source web', async () => {
    g.supabase = createSupabaseMock({
      finance_reserves: { select: { data: { id: 'res1', archived_at: null } } },
      finance_reserve_movements: { insert: { data: { id: 'm9' } } },
    })
    const res = await movimentos.POST(req({ amount: 100, type: 'withdrawal' }) as never, params('res1') as never)
    expect(res.status).toBe(201)
    const payload = g.supabase.callsTo('finance_reserve_movements', 'insert')[0].payload as Record<string, unknown>
    expect(payload.type).toBe('withdrawal')
    expect(payload.source).toBe('web')
    expect(payload.account_id).toBe('a1')
  })
})

describe('investimentos', () => {
  it('projeção vem null quando falta taxa — nunca um rendimento chutado', async () => {
    g.supabase = createSupabaseMock({
      finance_investments: { select: { data: [{
        id: 'i1', account_id: 'a1', kind: 'pf', name: 'Ações', type: 'renda_variavel',
        invested_amount: 1000, current_value: 1200, rate_type: null, rate_value: null,
        start_date: '2026-01-01', maturity_date: null, notes: null, created_at: '', updated_at: '',
      }] } },
    })
    const res = await investimentos.GET(req() as never)
    const json = await res.json()
    expect(json.investments[0].projection).toBeNull()
  })

  it('400 quando rate_type vem sem rate_value', async () => {
    const res = await investimentos.POST(
      req({ name: 'CDB', type: 'renda_fixa', invested_amount: 1000, rate_type: 'pct_cdi' }) as never
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('rate_value_required')
  })

  it('400 para tipo fora do enum', async () => {
    const res = await investimentos.POST(req({ name: 'X', type: 'poupanca', invested_amount: 10 }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('type_invalid')
  })

  it('rate_type null limpa a taxa junto', async () => {
    g.supabase = createSupabaseMock({ finance_investments: { update: { count: 1 } } })
    await investimentoId.PATCH(req({ rate_type: null }, undefined, 'PATCH') as never, params('i1') as never)
    const payload = g.supabase.callsTo('finance_investments', 'update')[0].payload as Record<string, unknown>
    expect(payload.rate_type).toBeNull()
    expect(payload.rate_value).toBeNull()
  })
})

describe('projeções', () => {
  it('400 em categoria de entrada — projeção é de gasto', async () => {
    g.supabase = createSupabaseMock({ finance_categories: { select: { data: [CAT_PF_IN] } } })
    const res = await projecoes.PUT(
      req({ category_id: 'c2', period_month: '2026-09', projected_amount: 100 }, undefined, 'PUT') as never
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('direction_invalid')
  })

  it('período vira o dia 1 do mês', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [CAT_PF_OUT] } },
      finance_projections: { select: { data: null }, insert: { data: { id: 'p1' } } },
    })
    const res = await projecoes.PUT(
      req({ category_id: 'c1', period_month: '2026-09', projected_amount: 800 }, undefined, 'PUT') as never
    )
    expect(res.status).toBe(201)
    const payload = g.supabase.callsTo('finance_projections', 'insert')[0].payload as Record<string, unknown>
    expect(payload.period_month).toBe('2026-09-01')
  })

  it('reeditar o mesmo mês atualiza em vez de duplicar', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [CAT_PF_OUT] } },
      finance_projections: { select: { data: { id: 'p1' } }, update: { data: null } },
    })
    const res = await projecoes.PUT(
      req({ category_id: 'c1', period_month: '2026-09', projected_amount: 900 }, undefined, 'PUT') as never
    )
    expect(res.status).toBe(200)
    expect(g.supabase.callsTo('finance_projections', 'insert')).toHaveLength(0)
    expect(g.supabase.callsTo('finance_projections', 'update')).toHaveLength(1)
  })

  it('aceita 0 (planejar não gastar) e recusa negativo', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [CAT_PF_OUT] } },
      finance_projections: { select: { data: null }, insert: { data: { id: 'p2' } } },
    })
    const zero = await projecoes.PUT(
      req({ category_id: 'c1', period_month: '2026-09', projected_amount: 0 }, undefined, 'PUT') as never
    )
    expect(zero.status).toBe(201)

    const negativo = await projecoes.PUT(
      req({ category_id: 'c1', period_month: '2026-09', projected_amount: -1 }, undefined, 'PUT') as never
    )
    expect(negativo.status).toBe(400)
  })
})

describe('metas', () => {
  it('400 quando meta manual vem sem valor-alvo', async () => {
    const res = await metas.POST(req({ name: 'Viagem', mode: 'manual' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('target_required')
  })

  it('meta automática não grava valor-alvo', async () => {
    g.supabase = createSupabaseMock({ finance_goals: { insert: { data: { id: 'g1' } } } })
    const res = await metas.POST(req({ name: 'Reserva de 6 meses', mode: 'auto', months_of_expenses: 6 }) as never)
    expect(res.status).toBe(201)
    const payload = g.supabase.callsTo('finance_goals', 'insert')[0].payload as Record<string, unknown>
    expect(payload.target_amount).toBeNull()
    expect(payload.months_of_expenses).toBe(6)
  })

  it('GET recalcula o status da meta auto a partir das projeções e saldos', async () => {
    g.supabase = createSupabaseMock({
      finance_goals: { select: { data: [{
        id: 'g1', account_id: 'a1', kind: 'pf', name: 'Reserva', mode: 'auto',
        target_amount: null, target_date: null, months_of_expenses: 3,
        linked_reserve_id: null, status: 'active', created_at: '', updated_at: '',
      }] } },
      finance_reserves: { select: { data: [RESERVE] } },
      finance_reserve_movements: { select: { data: [
        { id: 'm1', reserve_id: 'res1', account_id: 'a1', amount: 1000, type: 'deposit', source: 'web', note: null, occurred_at: '2026-09-01', created_at: '' },
      ] } },
      finance_investments: { select: { data: [] } },
      finance_projections: { select: { data: [
        { id: 'p1', account_id: 'a1', category_id: 'c1', subcategory_id: null, period_month: '2026-09-01', projected_amount: 2000, created_at: '', updated_at: '' },
      ] } },
    })
    const res = await metas.GET(req(undefined, 'https://app.test/api/finance/metas?periodo=2026-09') as never)
    const json = await res.json()
    // 2000 projetado × 3 meses = 6000; já guardados 1000.
    expect(json.goals[0].status_calc.requiredTotal).toBe(6000)
    expect(json.goals[0].status_calc.remaining).toBe(5000)
  })

  it('virar automática limpa o valor-alvo antigo', async () => {
    g.supabase = createSupabaseMock({
      finance_goals: {
        select: { data: { id: 'g1', mode: 'manual', target_amount: 5000, kind: 'pf' } },
        update: { data: null },
      },
    })
    await metaId.PATCH(req({ mode: 'auto' }, undefined, 'PATCH') as never, params('g1') as never)
    const payload = g.supabase.callsTo('finance_goals', 'update')[0].payload as Record<string, unknown>
    expect(payload.target_amount).toBeNull()
  })

  it('400 para status fora do enum', async () => {
    g.supabase = createSupabaseMock({
      finance_goals: { select: { data: { id: 'g1', mode: 'manual', target_amount: 100, kind: 'pf' } } },
    })
    const res = await metaId.PATCH(req({ status: 'pausada' }, undefined, 'PATCH') as never, params('g1') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('status_invalid')
  })
})

describe('sugestões', () => {
  it('sem projeção e sem histórico não sugere nada', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [CAT_PF_OUT] } },
      finance_entries: { select: { data: [
        { id: 'e1', account_id: 'a1', type: 'pf', direction: 'out', amount: 900, category_id: 'c1', subcategory_id: null, entry_date: '2026-09-03', category: null, revenue_entry_id: null },
      ] } },
      finance_projections: { select: { data: [] } },
      finance_suggestion_settings: { select: { data: null } },
      finance_suggestion_dismissals: { select: { data: [] } },
    })
    const res = await sugestoes.GET(req(undefined, 'https://app.test/api/finance/sugestoes?periodo=2026-09') as never)
    const json = await res.json()
    expect(json.suggestions).toHaveLength(0)
    expect(json.tolerance).toEqual({ projectionPct: 0, historyPct: 30 })
  })

  it('alerta quando o realizado passa a projeção', async () => {
    g.supabase = createSupabaseMock({
      finance_categories: { select: { data: [CAT_PF_OUT] } },
      finance_entries: { select: [
        { data: [{ id: 'e1', account_id: 'a1', type: 'pf', direction: 'out', amount: 900, category_id: 'c1', subcategory_id: null, entry_date: '2026-09-03', category: null, revenue_entry_id: null }] },
        { data: [] },
      ] },
      finance_projections: { select: { data: [
        { id: 'p1', account_id: 'a1', category_id: 'c1', subcategory_id: null, period_month: '2026-09-01', projected_amount: 600, created_at: '', updated_at: '' },
      ] } },
      finance_suggestion_settings: { select: { data: null } },
      finance_suggestion_dismissals: { select: { data: [] } },
    })
    const res = await sugestoes.GET(req(undefined, 'https://app.test/api/finance/sugestoes?periodo=2026-09') as never)
    const json = await res.json()
    expect(json.suggestions).toHaveLength(1)
    expect(json.suggestions[0].referenceType).toBe('projection')
    expect(json.suggestions[0].overAmount).toBe(300)
  })

  it('descartar duas vezes não estoura — responde ok', async () => {
    g.supabase = createSupabaseMock({
      finance_suggestion_dismissals: { select: { data: { id: 'd1' } } },
    })
    const res = await dismiss.POST(req({ category_id: 'c1', period_month: '2026-09' }) as never)
    expect(res.status).toBe(200)
    expect(g.supabase.callsTo('finance_suggestion_dismissals', 'insert')).toHaveLength(0)
  })

  it('descarte é gravado preso ao mês', async () => {
    g.supabase = createSupabaseMock({
      finance_suggestion_dismissals: { select: { data: null }, insert: { data: null } },
    })
    const res = await dismiss.POST(req({ category_id: 'c1', subcategory_id: 's1', period_month: '2026-09' }) as never)
    expect(res.status).toBe(201)
    const payload = g.supabase.callsTo('finance_suggestion_dismissals', 'insert')[0].payload as Record<string, unknown>
    expect(payload.period_month).toBe('2026-09-01')
    expect(payload.subcategory_id).toBe('s1')
  })

  it('400 para tolerância negativa', async () => {
    const res = await sugestoes.PUT(
      req({ projection_tolerance_pct: -5, history_tolerance_pct: 30 }, undefined, 'PUT') as never
    )
    expect(res.status).toBe(400)
  })
})
