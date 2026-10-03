import { describe, it, expect } from 'vitest'
import {
  buildAdminQueue,
  daysBetween,
  isOverdue,
  saoPauloDate,
  type QueueFeedbackRow,
  type QueueTaskRow,
} from '@/lib/admin/queue'
import type { CostAlertWithRef } from '@/lib/admin/cost-alerts'

// 2026-10-02 10:00 em São Paulo (UTC-3).
const NOW = new Date('2026-10-02T13:00:00Z')

function task(over: Partial<QueueTaskRow> = {}): QueueTaskRow {
  return {
    id: 't1',
    title: 'Tarefa',
    status: 'todo',
    due_date: null,
    position: 0,
    account_id: 'acc1',
    assigned_to: null,
    source_type: null,
    source_ref: null,
    created_at: '2026-09-30T12:00:00Z',
    accounts: { name: 'Clínica A' },
    ...over,
  }
}

function alert(over: Partial<CostAlertWithRef> = {}): CostAlertWithRef {
  return {
    kind: 'conversation_loop',
    accountId: 'acc1',
    accountName: 'Clínica A',
    detail: '3 conversas passaram de 25 respostas da Clara',
    cost: 10,
    ref: 'conversation_loop:acc1:2026-10',
    title: 'Conversas girando sem fechar',
    ...over,
  }
}

function feedback(over: Partial<QueueFeedbackRow> = {}): QueueFeedbackRow {
  return {
    id: 'f1',
    message: 'Queria exportar pacientes',
    created_at: '2026-09-28T12:00:00Z',
    account_id: 'acc2',
    user_id: null,
    accounts: { name: 'Clínica B' },
    ...over,
  }
}

function build(input: Partial<Parameters<typeof buildAdminQueue>[0]> = {}) {
  return buildAdminQueue({
    tasks: [],
    taskedRefs: [],
    alerts: [],
    alertDays: 30,
    feedback: [],
    profiles: [],
    now: NOW,
    ...input,
  })
}

describe('datas em São Paulo', () => {
  // 01:00 UTC do dia 3 ainda é 22:00 do dia 2 em São Paulo.
  it('saoPauloDate usa o fuso, não UTC', () => {
    expect(saoPauloDate(new Date('2026-10-03T01:00:00Z'))).toBe('2026-10-02')
    expect(saoPauloDate('2026-10-03T03:00:00Z')).toBe('2026-10-03')
  })

  it('daysBetween conta dias inteiros', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4)
    expect(daysBetween('2026-10-02', '2026-10-02')).toBe(0)
  })

  it('isOverdue: vence só depois que o dia passou', () => {
    expect(isOverdue('2026-10-01', '2026-10-02')).toBe(true)
    expect(isOverdue('2026-10-02', '2026-10-02')).toBe(false)
    expect(isOverdue(null, '2026-10-02')).toBe(false)
  })

  it('tarefa com prazo de hoje não está vencida às 22h de São Paulo', () => {
    const q = build({ tasks: [task({ due_date: '2026-10-02' })], now: new Date('2026-10-03T01:00:00Z') })
    expect(q.items[0].overdue).toBe(false)
  })
})

describe('buildAdminQueue — ordenação', () => {
  it('vencidas, depois alertas, depois feedback, depois o resto das tarefas', () => {
    const q = build({
      tasks: [task({ id: 'futura', due_date: '2026-10-10' }), task({ id: 'vencida', due_date: '2026-09-30' })],
      alerts: [alert()],
      feedback: [feedback()],
    })
    expect(q.items.map((i) => [i.kind, i.id])).toEqual([
      ['task', 'vencida'],
      ['alert', 'conversation_loop:acc1:2026-10'],
      ['feedback', 'f1'],
      ['task', 'futura'],
    ])
  })

  it('vencida há mais tempo primeiro, com idade em dias de atraso', () => {
    const q = build({
      tasks: [task({ id: 'a', due_date: '2026-10-01' }), task({ id: 'b', due_date: '2026-09-28' })],
    })
    expect(q.items.map((i) => [i.id, i.age, i.overdue])).toEqual([
      ['b', 4, true],
      ['a', 1, true],
    ])
    expect(q.counts.overdue).toBe(2)
  })

  it('alertas pelo custo, feedback do mais antigo', () => {
    const q = build({
      alerts: [alert({ ref: 'barato', cost: 1 }), alert({ ref: 'caro', cost: 50 })],
      feedback: [
        feedback({ id: 'novo', created_at: '2026-10-01T12:00:00Z' }),
        feedback({ id: 'velho', created_at: '2026-09-20T12:00:00Z' }),
      ],
    })
    expect(q.items.map((i) => i.id)).toEqual(['caro', 'barato', 'velho', 'novo'])
    expect(q.items.find((i) => i.id === 'velho')!.age).toBe(12)
  })

  it('tarefas não vencidas por prazo, sem prazo no fim', () => {
    const q = build({
      tasks: [
        task({ id: 'sem-prazo' }),
        task({ id: 'depois', due_date: '2026-10-20' }),
        task({ id: 'antes', due_date: '2026-10-05' }),
      ],
    })
    expect(q.items.map((i) => i.id)).toEqual(['antes', 'depois', 'sem-prazo'])
  })
})

describe('buildAdminQueue — dedup por source_ref', () => {
  it('alerta e feedback que já viraram tarefa não aparecem de novo', () => {
    const q = build({
      tasks: [task({ id: 't-alerta', source_type: 'cost_alert', source_ref: 'conversation_loop:acc1:2026-10' })],
      taskedRefs: ['conversation_loop:acc1:2026-10', 'f1'],
      alerts: [alert(), alert({ ref: 'custo_por_conversa:acc1:2026-10', kind: 'custo_por_conversa' })],
      feedback: [feedback(), feedback({ id: 'f2' })],
    })
    expect(q.items.map((i) => i.id)).toEqual(['custo_por_conversa:acc1:2026-10', 'f2', 't-alerta'])
    expect(q.counts).toEqual({ all: 3, task: 1, alert: 1, feedback: 1, overdue: 0 })
  })

  // Tarefa concluída também bloqueia: o índice único não deixa criar outra
  // com o mesmo ref, então o item não pode voltar para a fila.
  it('ref de tarefa concluída (só em taskedRefs) também some', () => {
    const q = build({ taskedRefs: new Set(['f1']), feedback: [feedback()] })
    expect(q.items).toEqual([])
    expect(q.taskedRefs).toEqual(['f1'])
  })
})

describe('buildAdminQueue — campos', () => {
  it('tarefa traz responsável, subtítulo e id da tarefa', () => {
    const q = build({
      tasks: [task({ assigned_to: 'u1', due_date: '2026-10-01' })],
      profiles: [{ id: 'u1', full_name: 'Rafael M.', email: 'r@x.com' }],
    })
    const [item] = q.items
    expect(item.taskId).toBe('t1')
    expect(item.assignee).toEqual({ id: 'u1', name: 'Rafael M.', email: 'r@x.com' })
    expect(item.subtitle).toBe('Clínica A · Rafael M.')
  })

  it('tarefa sem account é interna', () => {
    const q = build({ tasks: [task({ account_id: null, accounts: null })] })
    expect(q.items[0].subtitle).toBe('Interna')
  })

  it('alerta traz ref, custo e período no subtítulo', () => {
    const q = build({ alerts: [alert({ cost: 211.3 })] })
    const [item] = q.items
    expect(item.ref).toBe('conversation_loop:acc1:2026-10')
    expect(item.sourceType).toBe('cost_alert')
    expect(item.age).toBe(0)
    expect(item.subtitle).toMatch(/^Clínica A · R\$\s211,30 em 30 dias$/)
  })

  it('feedback usa o próprio id como ref e o autor no subtítulo', () => {
    const q = build({
      feedback: [feedback({ user_id: 'u2' })],
      profiles: [{ id: 'u2', full_name: 'Dra. Helena', email: null }],
    })
    const [item] = q.items
    expect(item.ref).toBe('f1')
    expect(item.sourceType).toBe('feedback')
    expect(item.subtitle).toBe('Clínica B · Dra. Helena')
  })
})
