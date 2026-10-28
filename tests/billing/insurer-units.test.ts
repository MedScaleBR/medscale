import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import { parseWorkspaceIds, syncInsurerWorkspaces, unitPaymentProblem, withWorkspaceIds } from '@/lib/billing/insurer-units'
import type { Database } from '@/types/database'

const client = (config: SupabaseMockConfig) => {
  const mock = createSupabaseMock(config)
  return { mock, supabase: mock.client as unknown as SupabaseClient<Database> }
}

const BASE = { accountId: 'acc1', workspaceId: 'w1' }

describe('unitPaymentProblem — Agenda respeita o que a unidade aceita', () => {
  it('recusa particular em unidade que não atende particular', async () => {
    const { supabase } = client({ workspaces: { select: { data: { name: 'Centro', accepts_private: false } } } })
    expect(await unitPaymentProblem(supabase, { ...BASE, insurerId: null, healthPlan: null })).toBe(
      'A unidade Centro não atende particular. Escolha um convênio.'
    )
  })

  it('aceita particular em unidade que atende particular', async () => {
    const { supabase } = client({ workspaces: { select: { data: { name: 'Centro', accepts_private: true } } } })
    expect(await unitPaymentProblem(supabase, { ...BASE, insurerId: null, healthPlan: null })).toBeNull()
  })

  it('recusa convênio não ligado à unidade e aceita o ligado', async () => {
    const workspaces = { select: { data: { name: 'Centro', accepts_private: true } } }
    const sem = client({ workspaces, health_insurer_workspaces: { select: { data: null } } })
    expect(await unitPaymentProblem(sem.supabase, { ...BASE, insurerId: 'i1', healthPlan: 'Unimed' })).toBe(
      'A unidade Centro não aceita este convênio.'
    )
    const com = client({ workspaces, health_insurer_workspaces: { select: { data: { insurer_id: 'i1' } } } })
    expect(await unitPaymentProblem(com.supabase, { ...BASE, insurerId: 'i1', healthPlan: 'Unimed' })).toBeNull()
  })

  it('sem módulo billing, acha o convênio pelo nome', async () => {
    const { supabase, mock } = client({
      workspaces: { select: { data: { name: 'Centro', accepts_private: true } } },
      health_insurers: { select: { data: { id: 'i9' } } },
      health_insurer_workspaces: { select: { data: null } },
    })
    expect(await unitPaymentProblem(supabase, { ...BASE, insurerId: null, healthPlan: 'Amil' })).toBe(
      'A unidade Centro não aceita este convênio.'
    )
    expect(mock.callsTo('health_insurer_workspaces', 'select')[0].filters).toContainEqual(['eq', 'insurer_id', 'i9'])
  })

  it('nome que não é convênio cadastrado (texto antigo) não é conferido', async () => {
    const { supabase } = client({
      workspaces: { select: { data: { name: 'Centro', accepts_private: false } } },
      health_insurers: { select: { data: null } },
    })
    expect(await unitPaymentProblem(supabase, { ...BASE, insurerId: null, healthPlan: 'Plano antigo' })).toBeNull()
  })

  it('sem a migration (erro de coluna/tabela) não bloqueia', async () => {
    const { supabase } = client({ workspaces: { select: { data: null, error: { message: 'column does not exist' } } } })
    expect(await unitPaymentProblem(supabase, { ...BASE, insurerId: 'i1', healthPlan: null })).toBeNull()
  })
})

describe('syncInsurerWorkspaces', () => {
  it('liga às unidades pedidas e remove as outras', async () => {
    const { supabase, mock } = client({ workspaces: { select: { data: [{ id: 'w1' }, { id: 'w2' }] } } })
    const res = await syncInsurerWorkspaces(supabase, 'acc1', 'i1', ['w1', 'w2'])
    expect(res).toEqual({ ok: true, value: ['w1', 'w2'] })
    expect(mock.callsTo('health_insurer_workspaces', 'delete')[0].filters).toContainEqual(['not', 'workspace_id', 'in', '(w1,w2)'])
    expect(mock.callsTo('health_insurer_workspaces', 'upsert')[0].payload).toEqual([
      { insurer_id: 'i1', workspace_id: 'w1', account_id: 'acc1' },
      { insurer_id: 'i1', workspace_id: 'w2', account_id: 'acc1' },
    ])
  })

  it('recusa unidade de outra account', async () => {
    const { supabase, mock } = client({ workspaces: { select: { data: [{ id: 'w1' }] } } })
    const res = await syncInsurerWorkspaces(supabase, 'acc1', 'i1', ['w1', 'w-outra'])
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(mock.callsTo('health_insurer_workspaces')).toHaveLength(0)
  })

  it('lista vazia desliga o convênio de todas as unidades', async () => {
    const { supabase, mock } = client({})
    await syncInsurerWorkspaces(supabase, 'acc1', 'i1', [])
    expect(mock.callsTo('health_insurer_workspaces', 'delete')).toHaveLength(1)
    expect(mock.callsTo('health_insurer_workspaces', 'upsert')).toHaveLength(0)
  })
})

describe('parseWorkspaceIds / withWorkspaceIds', () => {
  it('ausente não mexe; lista inválida é recusada', () => {
    expect(parseWorkspaceIds({})).toEqual({ ok: true, value: null })
    expect(parseWorkspaceIds({ workspace_ids: ['w1', 'w1'] })).toEqual({ ok: true, value: ['w1'] })
    expect(parseWorkspaceIds({ workspace_ids: 'w1' })).toMatchObject({ ok: false })
  })

  it('achata o vínculo aninhado', () => {
    expect(withWorkspaceIds({ id: 'i1', health_insurer_workspaces: [{ workspace_id: 'w1' }] })).toEqual({ id: 'i1', workspace_ids: ['w1'] })
    expect(withWorkspaceIds({ id: 'i1' })).toEqual({ id: 'i1', workspace_ids: null })
  })
})
