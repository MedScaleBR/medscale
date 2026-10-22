import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))

const deleteEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/google/calendar', () => ({ deleteEvent }))
const notifyOutsourcedIssue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/outsourced/notify', () => ({ notifyOutsourcedIssue }))

import { POST } from '@/app/api/cron/outsourced-timeout/route'

const NOW = new Date('2025-09-15T12:00:00.000Z')
const PENDING = 'pendente_confirmacao_externa'

function request(auth: string | null = 'Bearer cron-secret-test') {
  const headers = new Headers()
  if (auth !== null) headers.set('authorization', auth)
  return new Request('https://app.test/api/cron/outsourced-timeout', { method: 'POST', headers }) as never
}

const expired = (over: Record<string, unknown> = {}) => ({
  id: 'a-exp', account_id: 'acc1', workspace_id: 'w1', gcal_event_id: 'gcal-1', ...over,
})
const stale = (over: Record<string, unknown> = {}) => ({
  id: 'a-esc', account_id: 'acc1', workspace_id: 'w1', gcal_event_id: 'gcal-2', ...over,
})

function setup(expiredRows: unknown[], staleRows: unknown[], updateResult: unknown = { data: [{ id: 'x' }] }) {
  g.supabase = createSupabaseMock({
    appointments: {
      select: [{ data: expiredRows }, { data: staleRows }],
      update: updateResult as never,
    },
  })
}

describe('POST /api/cron/outsourced-timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    deleteEvent.mockReset().mockResolvedValue(undefined)
    notifyOutsourcedIssue.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('401 sem Authorization ou com segredo errado', async () => {
    setup([], [])
    expect((await POST(request(null))).status).toBe(401)
    expect((await POST(request('Bearer errado'))).status).toBe(401)
    expect(g.supabase.calls).toHaveLength(0)
  })

  it('expira pendentes vencidos com update condicional, apaga o evento e avisa a equipe', async () => {
    setup([expired()], [])
    const res = await POST(request())

    const select = g.supabase.callsTo('appointments', 'select')[0]
    expect(filterValue(select, 'eq', 'status')).toBe(PENDING)
    expect(filterValue(select, 'lt', 'scheduled_at')).toBe(NOW.toISOString())

    const update = g.supabase.callsTo('appointments', 'update')[0]
    expect(update.payload).toEqual({ status: 'cancelado' })
    expect(update.filters).toContainEqual(['eq', 'id', 'a-exp'])
    expect(update.filters).toContainEqual(['eq', 'status', PENDING])

    expect(deleteEvent).toHaveBeenCalledWith('w1', 'gcal-1')
    expect(notifyOutsourcedIssue).toHaveBeenCalledWith({
      accountId: 'acc1', workspaceId: 'w1', appointmentId: 'a-exp', reason: 'clinica_externa_timeout',
    })
    expect(await res.json()).toEqual({ escalated: 0, expired: 1, errors: [] })
  })

  it('não apaga evento quando não há gcal_event_id', async () => {
    setup([expired({ gcal_event_id: null })], [])
    await POST(request())
    expect(deleteEvent).not.toHaveBeenCalled()
    expect(notifyOutsourcedIssue).toHaveBeenCalledTimes(1)
  })

  it('se a confirmação chegou antes (update não afeta linha), não apaga nem avisa', async () => {
    setup([expired()], [], { data: [] })
    const res = await POST(request())
    expect(deleteEvent).not.toHaveBeenCalled()
    expect(notifyOutsourcedIssue).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ escalated: 0, expired: 0, errors: [] })
  })

  it('escala pendentes sem resposta há mais de 4h sem mudar o status', async () => {
    setup([], [stale()])
    const res = await POST(request())

    const select = g.supabase.callsTo('appointments', 'select')[1]
    expect(filterValue(select, 'eq', 'status')).toBe(PENDING)
    expect(filterValue(select, 'lt', 'external_requested_at')).toBe(
      new Date(NOW.getTime() - 4 * 3600_000).toISOString()
    )
    expect(select.filters).toContainEqual(['is', 'external_escalated_at', null])
    expect(filterValue(select, 'gte', 'scheduled_at')).toBe(NOW.toISOString())

    expect(notifyOutsourcedIssue).toHaveBeenCalledWith({
      accountId: 'acc1', workspaceId: 'w1', appointmentId: 'a-esc', reason: 'clinica_externa_timeout',
    })
    const updates = g.supabase.callsTo('appointments', 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ external_escalated_at: NOW.toISOString() })
    expect(await res.json()).toEqual({ escalated: 1, expired: 0, errors: [] })
  })

  it('pendente vencido não recebe as duas notificações (expira antes de escalar)', async () => {
    // A 2ª consulta (escalar) roda depois da expiração, então já não devolve o vencido.
    setup([expired({ id: 'dup' })], [])
    const res = await POST(request())
    expect(notifyOutsourcedIssue).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ escalated: 0, expired: 1 })
    const selects = g.supabase.callsTo('appointments', 'select')
    expect(selects[0].filters).toContainEqual(['lt', 'scheduled_at', NOW.toISOString()])
    expect(selects[1].filters).toContainEqual(['gte', 'scheduled_at', NOW.toISOString()])
  })

  it('falha num item vai para errors com o id e não interrompe os outros', async () => {
    setup([expired({ id: 'a1' }), expired({ id: 'a2', gcal_event_id: 'gcal-9' })], [])
    deleteEvent.mockRejectedValueOnce(new Error('google fora'))
    const res = await POST(request())
    const body = await res.json()
    expect(body.expired).toBe(2)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]).toContain('a1')
    expect(notifyOutsourcedIssue).toHaveBeenCalledTimes(2)
  })

  it('deleteEvent rejeitado: registra o erro com o id e ainda avisa a equipe uma vez', async () => {
    setup([expired()], [])
    deleteEvent.mockRejectedValueOnce(new Error('410 gone'))
    const body = await (await POST(request())).json()
    expect(notifyOutsourcedIssue).toHaveBeenCalledTimes(1)
    expect(body.errors).toEqual(['a-exp: 410 gone'])
    expect(body.expired).toBe(1)
  })
})
