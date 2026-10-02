import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock, redirect: vi.fn(), role: 'owner' }))
vi.mock('next/navigation', () => ({ redirect: g.redirect, notFound: () => { throw new Error('Not found') } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/server', () => ({
  resolveActiveSession: async () => ({
    workspaceId: 'w1',
    accountId: 'a1',
    role: g.role,
    allWorkspaces: [{ id: 'w1', name: 'Centro' }, { id: 'w2', name: 'Zona Sul' }],
  }),
}))
vi.mock('@/lib/session/session-context', () => ({
  useAnalyticsBase: () => ({ workspace_id: 'w1', account_id: 'a1' }),
}))

import ExpedientePage from '@/app/(dashboard)/expediente/page'
import UnitPage from '@/app/(dashboard)/locais/[id]/page'
import { AvailabilitySettings } from '@/components/configuracoes/AvailabilitySettings'
import type { Database } from '@/types/database'

const rules = [
  { id: 'r1', workspace_id: 'w1', day_of_week: 1, start_time: '08:00', end_time: '09:00', slot_duration: 30 },
  { id: 'r2', workspace_id: 'w2', day_of_week: 1, start_time: '14:00', end_time: '15:00', slot_duration: 30 },
] as Database['public']['Tables']['availability_rules']['Row'][]

describe('expediente por local', () => {
  beforeEach(() => {
    g.role = 'owner'
    g.redirect.mockClear()
    g.supabase = createSupabaseMock({
      workspaces: { select: { data: { id: 'w2', name: 'Zona Sul' } } },
      availability_rules: { select: { data: [rules[1]] } },
      availability_exceptions: { select: { data: [] } },
    })
  })

  it('redireciona o antigo expediente para os locais', async () => {
    await ExpedientePage()
    expect(g.redirect).toHaveBeenCalledWith('/locais')
  })

  it('carrega o expediente apenas da unidade selecionada após validar a conta', async () => {
    const page = await UnitPage({ params: Promise.resolve({ id: 'w2' }) })
    const html = renderToStaticMarkup(page)
    expect(filterValue(g.supabase.callsTo('workspaces')[0], 'eq', 'account_id')).toBe('a1')
    for (const table of ['availability_rules', 'availability_exceptions']) {
      expect(filterValue(g.supabase.callsTo(table)[0], 'eq', 'workspace_id')).toBe('w2')
    }
    expect(html).toContain('Horários de atendimento recorrentes')
    expect(html).toContain('14:00')
    expect(html).not.toContain('Horário de atendimento presencial (texto livre)')
    expect(html).not.toContain('Horário de atendimento humano')
    expect(html).not.toContain('Local de atendimento')
  })

  it('preserva a edição do expediente pelo membro', async () => {
    g.role = 'member'
    const page = await UnitPage({ params: Promise.resolve({ id: 'w2' }) })
    const html = renderToStaticMarkup(page)
    expect(html).toContain('14:00')
    expect(html).toContain('Excluir horário')
    expect(html).toContain('Adicionar')
    expect(html).toContain('Bloquear dia')
  })

  it('não consulta horários quando a unidade não pertence à conta', async () => {
    g.supabase = createSupabaseMock({ workspaces: { select: { data: null } } })
    await expect(UnitPage({ params: Promise.resolve({ id: 'other-unit' }) })).rejects.toThrow('Not found')
    expect(g.supabase.callsTo('availability_rules')).toHaveLength(0)
    expect(g.supabase.callsTo('availability_exceptions')).toHaveLength(0)
  })

  it('permite escolher o local e mostra somente os horários do local selecionado', () => {
    const html = renderToStaticMarkup(createElement(AvailabilitySettings, {
      initialRules: rules,
      initialExceptions: [
        { id: 'e1', workspace_id: 'w1', date: '2030-09-16', type: 'blocked', reason: 'Feriado do Centro' },
        { id: 'e2', workspace_id: 'w2', date: '2030-09-17', type: 'blocked', reason: 'Férias da Zona Sul' },
      ] as Database['public']['Tables']['availability_exceptions']['Row'][],
      workspaces: [{ id: 'w1', name: 'Centro' }, { id: 'w2', name: 'Zona Sul' }],
      initialWorkspaceId: 'w2',
    } as Parameters<typeof AvailabilitySettings>[0]))
    expect(html).toContain('Local de atendimento')
    expect(html).toContain('Zona Sul')
    expect(html).toContain('14:00')
    expect(html).not.toContain('08:00–09:00')
    expect(html).toContain('Férias da Zona Sul')
    expect(html).not.toContain('Feriado do Centro')
  })

  it('mostra dias bloqueados seguidos como um único período', () => {
    const html = renderToStaticMarkup(createElement(AvailabilitySettings, {
      initialRules: [],
      initialExceptions: ['2030-07-01', '2030-07-02', '2030-07-03'].map((date, i) => (
        { id: `e${i}`, workspace_id: 'w1', date, type: 'blocked', start_time: null, reason: 'Férias' }
      )) as Database['public']['Tables']['availability_exceptions']['Row'][],
      workspaces: [{ id: 'w1', name: 'Centro' }],
      initialWorkspaceId: 'w1',
    } as Parameters<typeof AvailabilitySettings>[0]))
    expect(html).toContain('01/07/2030 a 03/07/2030')
    expect(html.match(/Férias/g)).toHaveLength(1)
  })
})
