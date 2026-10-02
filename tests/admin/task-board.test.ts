import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FILTERS,
  MIN_POSITION_GAP,
  POSITION_STEP,
  applyMove,
  applyPositions,
  buildColumns,
  canDropInto,
  compareTasks,
  countOverdue,
  dropPosition,
  endPosition,
  findColumn,
  inboxId,
  inboxTaskPayload,
  isRecentlyDone,
  isTaskOverdue,
  listTasks,
  movePatchBody,
  optimisticTaskFromInbox,
  planDrop,
  positionBetween,
  relocate,
  reorderWithin,
  replaceTask,
  shortDate,
  taskFromRow,
  truncateTitle,
  type BoardContext,
  type BoardTask,
  type InboxCard,
} from '@/components/admin/tasks/board-logic'

const TODAY = '2026-10-02'
const CTX: BoardContext = { today: TODAY, userId: 'me' }

function task(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 't1',
    title: 'Tarefa',
    description: null,
    dueDate: null,
    status: 'todo',
    position: 0,
    accountId: 'acc1',
    accountName: 'Clínica Vitta',
    assignedTo: null,
    assigneeName: null,
    assigneeEmail: null,
    sourceType: null,
    sourceRef: null,
    completedAt: null,
    createdAt: '2026-09-20T12:00:00Z',
    ...over,
  }
}

function card(over: Partial<InboxCard> = {}): InboxCard {
  const ref = over.ref ?? 'loop:acc1:2026-10'
  return {
    id: inboxId(ref),
    ref,
    sourceType: 'cost_alert',
    title: 'Conversas girando sem fechar',
    detail: '120 conversas sem fechamento',
    accountId: 'acc1',
    accountName: 'Clínica Vitta',
    age: 0,
    cost: 211.3,
    order: 0,
    ...over,
  }
}

describe('positionBetween', () => {
  it('usa a média entre vizinhos', () => {
    expect(positionBetween(0, 1024)).toBe(512)
    expect(positionBetween(-10, 10)).toBe(0)
  })

  it('soma ou subtrai o passo nas pontas', () => {
    expect(positionBetween(2048, null)).toBe(2048 + POSITION_STEP)
    expect(positionBetween(null, 100)).toBe(100 - POSITION_STEP)
  })

  it('devolve 0 em coluna vazia', () => {
    expect(positionBetween(null, undefined)).toBe(0)
  })
})

describe('compareTasks', () => {
  it('ordena por position, depois prazo (sem prazo no fim), depois criação', () => {
    const tasks = [
      task({ id: 'c', position: 1, dueDate: null }),
      task({ id: 'b', position: 1, dueDate: '2026-10-10' }),
      task({ id: 'a', position: 0, dueDate: '2026-12-01' }),
      task({ id: 'd', position: 1, dueDate: '2026-10-05', createdAt: '2026-09-21T00:00:00Z' }),
      task({ id: 'e', position: 1, dueDate: '2026-10-05', createdAt: '2026-09-19T00:00:00Z' }),
    ]
    expect([...tasks].sort(compareTasks).map((t) => t.id)).toEqual(['a', 'e', 'd', 'b', 'c'])
  })
})

describe('datas no fuso de São Paulo', () => {
  it('vencida só quando o prazo já passou e a tarefa não foi concluída', () => {
    expect(isTaskOverdue({ dueDate: '2026-10-01', status: 'todo' }, TODAY)).toBe(true)
    expect(isTaskOverdue({ dueDate: TODAY, status: 'doing' }, TODAY)).toBe(false)
    expect(isTaskOverdue({ dueDate: '2026-09-01', status: 'done' }, TODAY)).toBe(false)
    expect(isTaskOverdue({ dueDate: null, status: 'todo' }, TODAY)).toBe(false)
  })

  it('concluídas dos últimos 7 dias contam hoje e os 6 dias anteriores', () => {
    const done = (completedAt: string | null) => ({ status: 'done' as const, completedAt })
    expect(isRecentlyDone(done('2026-10-02T12:00:00Z'), TODAY)).toBe(true)
    expect(isRecentlyDone(done('2026-09-26T12:00:00Z'), TODAY)).toBe(true)
    expect(isRecentlyDone(done('2026-09-25T12:00:00Z'), TODAY)).toBe(false)
    expect(isRecentlyDone(done(null), TODAY)).toBe(false)
    expect(isRecentlyDone({ status: 'todo', completedAt: '2026-10-02T12:00:00Z' }, TODAY)).toBe(false)
  })

  it('usa o dia de São Paulo, não o UTC', () => {
    // 26/09 01:00 UTC = 25/09 22:00 em São Paulo → fora da janela.
    expect(isRecentlyDone({ status: 'done', completedAt: '2026-09-26T01:00:00Z' }, TODAY)).toBe(false)
    // 03/10 02:00 UTC = 02/10 23:00 em São Paulo → hoje.
    expect(isRecentlyDone({ status: 'done', completedAt: '2026-10-03T02:00:00Z' }, TODAY)).toBe(true)
  })

  it('conta vencidas', () => {
    const tasks = [
      task({ id: 'a', dueDate: '2026-09-28' }),
      task({ id: 'b', dueDate: '2026-09-28', status: 'done' }),
      task({ id: 'c', dueDate: '2026-10-08' }),
    ]
    expect(countOverdue(tasks, TODAY)).toBe(1)
  })
})

describe('buildColumns', () => {
  const tasks = [
    task({ id: 'todo2', status: 'todo', position: 2048 }),
    task({ id: 'todo1', status: 'todo', position: 1024 }),
    task({ id: 'doing1', status: 'doing', assignedTo: 'me' }),
    task({ id: 'doneNew', status: 'done', completedAt: '2026-09-30T12:00:00Z' }),
    task({ id: 'doneOld', status: 'done', completedAt: '2026-09-01T12:00:00Z' }),
    task({ id: 'late', status: 'todo', position: 3000, dueDate: '2026-09-28', accountId: null, accountName: null }),
  ]
  const inbox = [
    card({ ref: 'b', order: 1, sourceType: 'feedback', title: 'Exportar lista de pacientes', accountName: 'Dermato Prime', accountId: 'acc2' }),
    card({ ref: 'a', order: 0 }),
  ]

  it('separa por coluna, ordena e esconde concluídas antigas', () => {
    const cols = buildColumns(tasks, inbox, DEFAULT_FILTERS, CTX)
    expect(cols.inbox.map((i) => i.id)).toEqual([inboxId('a'), inboxId('b')])
    expect(cols.todo.map((i) => i.id)).toEqual(['todo1', 'todo2', 'late'])
    expect(cols.doing.map((i) => i.id)).toEqual(['doing1'])
    expect(cols.done.map((i) => i.id)).toEqual(['doneNew'])
  })

  it('busca em título e cliente, sem acento e sem caixa', () => {
    const cols = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, query: 'DERMATO' }, CTX)
    expect(cols.inbox.map((i) => i.id)).toEqual([inboxId('b')])
    expect(cols.todo).toHaveLength(0)
    const interna = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, query: 'interna' }, CTX)
    expect(interna.todo.map((i) => i.id)).toEqual(['late'])
  })

  it('"Meus cartões" usa o usuário logado e esconde a Entrada', () => {
    const cols = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, assignee: 'mine' }, CTX)
    expect(cols.doing.map((i) => i.id)).toEqual(['doing1'])
    expect(cols.todo).toHaveLength(0)
    expect(cols.inbox).toHaveLength(0)
    const anon = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, assignee: 'mine' }, { ...CTX, userId: null })
    expect(anon.doing).toHaveLength(0)
  })

  it('"Só vencidos" mostra apenas tarefas vencidas', () => {
    const cols = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, overdueOnly: true }, CTX)
    expect(cols.todo.map((i) => i.id)).toEqual(['late'])
    expect(cols.inbox).toHaveLength(0)
    expect(cols.done).toHaveLength(0)
  })

  it('filtra por cliente, incluindo "sem cliente"', () => {
    const none = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, account: 'none' }, CTX)
    expect(none.todo.map((i) => i.id)).toEqual(['late'])
    expect(none.inbox).toHaveLength(0)
    const acc2 = buildColumns(tasks, inbox, { ...DEFAULT_FILTERS, account: 'acc2' }, CTX)
    expect(acc2.inbox.map((i) => i.id)).toEqual([inboxId('b')])
    expect(acc2.todo).toHaveLength(0)
  })
})

describe('arrastar', () => {
  const tasks = [
    task({ id: 'a', status: 'todo', position: 0 }),
    task({ id: 'b', status: 'todo', position: 1024 }),
    task({ id: 'c', status: 'todo', position: 2048 }),
    task({ id: 'x', status: 'doing', position: 500 }),
  ]
  const inbox = [card({ ref: 'r1' })]
  const cols = buildColumns(tasks, inbox, DEFAULT_FILTERS, CTX)

  it('Entrada não recebe cartões de outras colunas', () => {
    expect(canDropInto('todo', 'inbox')).toBe(false)
    expect(canDropInto('inbox', 'inbox')).toBe(true)
    expect(canDropInto('inbox', 'done')).toBe(true)
    expect(canDropInto('doing', 'todo')).toBe(true)
  })

  it('acha a coluna de um cartão ou da própria coluna', () => {
    expect(findColumn(cols, 'b')).toBe('todo')
    expect(findColumn(cols, inboxId('r1'))).toBe('inbox')
    expect(findColumn(cols, 'doing')).toBe('doing')
    expect(findColumn(cols, 'nada')).toBeNull()
  })

  it('reordena na mesma coluna e calcula a média entre os vizinhos', () => {
    const list = reorderWithin(cols.todo, 'c', 'a')
    expect(list.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(dropPosition(list, 'c')).toBe(0 - POSITION_STEP)
    const middle = reorderWithin(cols.todo, 'a', 'b')
    expect(middle.map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(dropPosition(middle, 'a')).toBe(1536)
  })

  it('move entre colunas pela pré-visualização', () => {
    const moved = relocate(cols, 'b', 'doing', 1)
    expect(moved.todo.map((i) => i.id)).toEqual(['a', 'c'])
    expect(moved.doing.map((i) => i.id)).toEqual(['x', 'b'])
    expect(moved.doing[1].column).toBe('doing')
    expect(dropPosition(moved.doing, 'b')).toBe(500 + POSITION_STEP)
    const top = relocate(cols, 'b', 'doing', 0)
    expect(dropPosition(top.doing, 'b')).toBe(500 - POSITION_STEP)
  })

  it('limita o índice ao tamanho da coluna e aceita coluna vazia', () => {
    const moved = relocate(cols, 'a', 'done', 99)
    expect(moved.done.map((i) => i.id)).toEqual(['a'])
    expect(dropPosition(moved.done, 'a')).toBe(0)
  })

  it('cartão da Entrada usa só tarefas como vizinhas', () => {
    const moved = relocate(cols, inboxId('r1'), 'todo', 1)
    expect(moved.inbox).toHaveLength(0)
    expect(moved.todo.map((i) => i.id)).toEqual(['a', inboxId('r1'), 'b', 'c'])
    expect(dropPosition(moved.todo, inboxId('r1'))).toBe(512)
  })

  it('mantém a média quando há espaço entre os vizinhos', () => {
    const middle = reorderWithin(cols.todo, 'a', 'b')
    expect(planDrop(middle, 'a')).toEqual({ position: 1536, others: [] })
  })

  it('renumera a coluna quando os vizinhos têm a mesma position', () => {
    const flat = buildColumns(
      [
        task({ id: 'p', position: 0, createdAt: '2026-09-01T00:00:00Z' }),
        task({ id: 'q', position: 0, createdAt: '2026-09-02T00:00:00Z' }),
        task({ id: 'r', position: 0, createdAt: '2026-09-03T00:00:00Z' }),
      ],
      [],
      DEFAULT_FILTERS,
      CTX,
    )
    const list = reorderWithin(flat.todo, 'r', 'q')
    expect(list.map((i) => i.id)).toEqual(['p', 'r', 'q'])
    // Média de 0 e 0 é 0: a ordem não persistiria.
    expect(dropPosition(list, 'r')).toBe(0)
    const plan = planDrop(list, 'r')
    expect(plan.position).toBe(POSITION_STEP)
    // 'p' já está em 0: só 'q' precisa de PATCH.
    expect(plan.others).toEqual([{ id: 'q', position: 2 * POSITION_STEP }])

    const after = applyPositions(
      applyMove(flat.todo.map((i) => (i.type === 'task' ? i.task : task())), 'r', 'todo', plan.position, TODAY),
      plan.others,
    )
    const rebuilt = buildColumns(after, [], DEFAULT_FILTERS, CTX)
    expect(rebuilt.todo.map((i) => i.id)).toEqual(['p', 'r', 'q'])
  })

  it('renumera quando a folga entre vizinhos é menor que MIN_POSITION_GAP', () => {
    const tight = buildColumns(
      [task({ id: 'a', position: 1 }), task({ id: 'b', position: 1 + MIN_POSITION_GAP / 2 }), task({ id: 'z', status: 'doing' })],
      [],
      DEFAULT_FILTERS,
      CTX,
    )
    const moved = relocate(tight, 'z', 'todo', 1)
    const plan = planDrop(moved.todo, 'z')
    expect(plan.position).toBe(POSITION_STEP)
    expect(plan.others).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 2 * POSITION_STEP },
    ])
  })

  it('cartão da Entrada também renumera vizinhos empatados', () => {
    const flat = buildColumns(
      [task({ id: 'p', position: 5 }), task({ id: 'q', position: 5 })],
      [card({ ref: 'r9' })],
      DEFAULT_FILTERS,
      CTX,
    )
    const moved = relocate(flat, inboxId('r9'), 'todo', 1)
    expect(planDrop(moved.todo, inboxId('r9'))).toEqual({
      position: POSITION_STEP,
      others: [
        { id: 'p', position: 0 },
        { id: 'q', position: 2 * POSITION_STEP },
      ],
    })
  })

  it('PATCH de movimento só manda status quando muda de coluna', () => {
    expect(movePatchBody('todo', 'todo', 512)).toEqual({ position: 512 })
    expect(movePatchBody('todo', 'done', 512)).toEqual({ status: 'done', position: 512 })
  })

  it('aplica status, posição e completed_at', () => {
    const now = '2026-10-02T15:00:00Z'
    const done = applyMove(tasks, 'a', 'done', 10, now).find((t) => t.id === 'a')!
    expect(done).toMatchObject({ status: 'done', position: 10, completedAt: now })
    const reopened = applyMove([{ ...done }], 'a', 'todo', 5, now)[0]
    expect(reopened.completedAt).toBeNull()
    const stillDone = applyMove([{ ...done, completedAt: '2026-09-30T00:00:00Z' }], 'a', 'done', 1, now)[0]
    expect(stillDone.completedAt).toBe('2026-09-30T00:00:00Z')
  })

  it('posição no fim da coluna', () => {
    expect(endPosition(tasks, 'todo')).toBe(2048 + POSITION_STEP)
    expect(endPosition(tasks, 'done')).toBe(0)
  })
})

describe('virar tarefa a partir da Entrada', () => {
  it('monta o POST com a origem e a coluna de destino', () => {
    expect(inboxTaskPayload(card(), 'doing', 300)).toEqual({
      title: 'Conversas girando sem fechar',
      description: null,
      account_id: 'acc1',
      status: 'doing',
      position: 300,
      source_type: 'cost_alert',
      source_ref: 'loop:acc1:2026-10',
    })
  })

  it('feedback longo vira título curto com a mensagem inteira na descrição', () => {
    const message = 'a'.repeat(300)
    const payload = inboxTaskPayload(card({ sourceType: 'feedback', title: message, detail: message, ref: 'fb1' }), 'todo', 0)
    expect(payload.title.length).toBeLessThanOrEqual(140)
    expect(payload.title.endsWith('…')).toBe(true)
    expect(payload.description).toBe(message)
    expect(truncateTitle('  curto \n texto ')).toBe('curto texto')
  })

  it('troca a tarefa otimista pela devolvida, sem duplicar a já existente (200)', () => {
    const temp = optimisticTaskFromInbox(card(), 'todo', 0, '2026-10-02T15:00:00Z')
    expect(temp).toMatchObject({ id: 'tmp:loop:acc1:2026-10', saving: true, sourceRef: 'loop:acc1:2026-10' })
    const existing = task({ id: 'real', sourceType: 'cost_alert', sourceRef: 'loop:acc1:2026-10', status: 'doing' })
    const result = replaceTask([task({ id: 'other' }), existing, temp], temp.id, existing)
    expect(result.map((t) => t.id).sort()).toEqual(['other', 'real'])
  })

  it('converte a linha da API com responsável e cliente', () => {
    const t = taskFromRow(
      {
        id: 'n1',
        title: 'Nova',
        description: null,
        due_date: '2026-10-08',
        status: 'todo',
        position: null,
        account_id: 'acc1',
        assigned_to: 'u1',
        source_type: null,
        source_ref: null,
        completed_at: null,
        created_at: '2026-10-02T12:00:00Z',
      },
      { accountName: 'Clínica Vitta', people: [{ id: 'u1', name: 'Rafael Moura', email: 'r@x.com' }] },
    )
    expect(t).toMatchObject({ position: 0, assigneeName: 'Rafael Moura', accountName: 'Clínica Vitta', dueDate: '2026-10-08' })
  })
})

describe('modo lista', () => {
  const tasks = [
    task({ id: 'semPrazo' }),
    task({ id: 'depois', dueDate: '2026-10-20' }),
    task({ id: 'antes', dueDate: '2026-10-05' }),
    task({ id: 'feita', status: 'done', dueDate: '2026-01-01', completedAt: '2026-01-02T00:00:00Z' }),
  ]

  it('pendentes ordenadas por prazo, sem prazo no fim', () => {
    expect(listTasks(tasks, DEFAULT_FILTERS, 'open', CTX).map((t) => t.id)).toEqual(['antes', 'depois', 'semPrazo'])
  })

  it('concluídas incluem as antigas (fora dos 7 dias do quadro)', () => {
    expect(listTasks(tasks, DEFAULT_FILTERS, 'done', CTX).map((t) => t.id)).toEqual(['feita'])
    expect(listTasks(tasks, DEFAULT_FILTERS, 'all', CTX)).toHaveLength(4)
  })
})

it('formata data curta dd/MM', () => {
  expect(shortDate('2026-09-28')).toBe('28/09')
})
