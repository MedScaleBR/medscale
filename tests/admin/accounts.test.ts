import { describe, it, expect } from 'vitest'
import {
  buildAccountRows,
  countToggleableModules,
  sumCost,
  TOGGLEABLE_MODULES,
  type AccountBaseRow,
} from '@/lib/admin/accounts'

function account(over: Partial<AccountBaseRow> = {}): AccountBaseRow {
  return {
    id: 'acc1',
    name: 'Clínica A',
    slug: 'clinica-a',
    plan: 'essencial',
    is_active: true,
    modules: ['dashboard', 'agenda', 'patients', 'settings'],
    created_at: '2026-09-01T12:00:00Z',
    ...over,
  }
}

const TODAY = '2026-10-02'

describe('countToggleableModules', () => {
  it('ignora módulos sempre ativos e duplicados', () => {
    expect(countToggleableModules(['dashboard', 'patients', 'settings'])).toBe(0)
    expect(countToggleableModules(['agenda', 'agenda', 'billing', 'dashboard'])).toBe(2)
    expect(countToggleableModules(null)).toBe(0)
  })

  it('conta todos os 10 quando a account tem tudo', () => {
    expect(countToggleableModules(TOGGLEABLE_MODULES.map((m) => m.slug))).toBe(10)
  })
})

describe('sumCost', () => {
  it('soma números e strings numéricas, ignorando lixo', () => {
    expect(sumCost([{ cost_brl: 1.5 }, { cost_brl: '2.25' }, { cost_brl: null }, { cost_brl: 'x' }])).toBeCloseTo(3.75)
  })
})

describe('buildAccountRows', () => {
  it('agrega membros, custo e tarefas por account_id', () => {
    const rows = buildAccountRows({
      accounts: [account(), account({ id: 'acc2', name: 'Clínica B', modules: ['agenda', 'conversations'] })],
      memberships: [{ account_id: 'acc1' }, { account_id: 'acc1' }, { account_id: 'acc2' }],
      costs: [
        { account_id: 'acc1', cost_brl: 60 },
        { account_id: 'acc1', cost_brl: '50.5' },
        { account_id: 'acc2', cost_brl: 3 },
      ],
      tasks: [
        { account_id: 'acc1', due_date: '2026-10-01', status: 'todo' },
        { account_id: 'acc1', due_date: '2026-10-02', status: 'doing' },
        { account_id: 'acc1', due_date: null, status: 'todo' },
        { account_id: 'acc2', due_date: '2026-09-01', status: 'done' },
        { account_id: null, due_date: '2026-09-01', status: 'todo' },
      ],
      today: TODAY,
    })

    expect(rows[0]).toMatchObject({
      id: 'acc1',
      modulesOn: 1,
      modulesTotal: 10,
      members: 2,
      openTasks: 3,
      overdueTasks: 1,
    })
    expect(rows[0].cost30d).toBeCloseTo(110.5)
    expect(rows[1]).toMatchObject({ id: 'acc2', modulesOn: 2, members: 1, cost30d: 3, openTasks: 0, overdueTasks: 0 })
  })

  it('vencida só quando o prazo é anterior a hoje (o próprio dia não vence)', () => {
    const [row] = buildAccountRows({
      accounts: [account()],
      memberships: [],
      costs: [],
      tasks: [{ account_id: 'acc1', due_date: TODAY, status: 'todo' }],
      today: TODAY,
    })
    expect(row.overdueTasks).toBe(0)
    expect(row.openTasks).toBe(1)
  })

  it('account sem dados relacionados sai zerada, na ordem recebida', () => {
    const rows = buildAccountRows({
      accounts: [account({ id: 'b' }), account({ id: 'a' })],
      memberships: [{ account_id: 'outra' }],
      costs: [{ account_id: 'outra', cost_brl: 999 }],
      tasks: [],
      today: TODAY,
    })
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows[0]).toMatchObject({ members: 0, cost30d: 0, openTasks: 0, overdueTasks: 0 })
  })
})
