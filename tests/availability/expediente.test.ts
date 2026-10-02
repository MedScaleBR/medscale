import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/server', () => ({
  resolveActiveSession: async () => ({
    workspaceId: 'w1',
    allWorkspaces: [{ id: 'w1', name: 'Centro' }, { id: 'w2', name: 'Zona Sul' }],
  }),
}))
vi.mock('@/lib/session/session-context', () => ({
  useAnalyticsBase: () => ({ workspace_id: 'w1', account_id: 'a1' }),
}))

import ExpedientePage from '@/app/(dashboard)/expediente/page'
import { AvailabilitySettings } from '@/components/configuracoes/AvailabilitySettings'
import type { Database } from '@/types/database'

const rules = [
  { id: 'r1', workspace_id: 'w1', day_of_week: 1, start_time: '08:00', end_time: '09:00', slot_duration: 30 },
  { id: 'r2', workspace_id: 'w2', day_of_week: 1, start_time: '14:00', end_time: '15:00', slot_duration: 30 },
] as Database['public']['Tables']['availability_rules']['Row'][]

describe('expediente por local', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock(Object.fromEntries(
      ['availability_rules', 'availability_exceptions'].map((table) => [table, {
        select: (call: Parameters<typeof filterValue>[0]) => {
          const ids = filterValue(call, 'in', 'workspace_id') as string[] | undefined
          const id = filterValue(call, 'eq', 'workspace_id')
          return { data: table === 'availability_rules' ? rules.filter((r) => ids?.includes(r.workspace_id) || r.workspace_id === id) : [] }
        },
      }]),
    ))
  })

  it('carrega o expediente de todos os locais acessíveis, sem consultar locais de outras contas', async () => {
    await ExpedientePage()
    for (const table of ['availability_rules', 'availability_exceptions']) {
      expect(filterValue(g.supabase.callsTo(table)[0], 'in', 'workspace_id')).toEqual(['w1', 'w2'])
    }
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
})
