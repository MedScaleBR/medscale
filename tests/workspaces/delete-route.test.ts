import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import {
  ARCHIVE_LAST_UNIT_ERROR,
  ARCHIVE_NOT_FOUND_ERROR,
  archiveFutureAppointmentsError,
} from '@/lib/workspaces/archive'

const g = vi.hoisted(() => ({
  supabase: null as unknown,
  resolveActiveSession: vi.fn(),
}))

vi.mock('@/lib/session/server', () => ({ resolveActiveSession: g.resolveActiveSession }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => (g.supabase as SupabaseMock).client,
}))

import { DELETE } from '@/app/api/workspaces/[id]/route'

type Unit = { id: string; slug: string; is_active: boolean; is_default: boolean; display_order: number }

const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({
  id,
  slug: `unidade-${id}`,
  is_active: true,
  is_default: false,
  display_order: 0,
  ...extra,
})

let mock: SupabaseMock

function setup(units: Unit[], futureCount = 0) {
  mock = createSupabaseMock({
    workspaces: { select: { data: units }, update: { data: null } },
    appointments: { select: { data: null, count: futureCount } },
  })
  g.supabase = mock
}

const del = (id = 'w1') =>
  DELETE(new NextRequest(`http://localhost/api/workspaces/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

describe('DELETE /api/workspaces/[id] — excluir unidade', () => {
  beforeEach(() => {
    g.resolveActiveSession.mockReset()
    g.resolveActiveSession.mockResolvedValue({ accountId: 'a1', role: 'owner' })
    setup([unit('w1'), unit('w2', { is_default: true })])
  })

  it('member recebe 403 e nada é consultado', async () => {
    g.resolveActiveSession.mockResolvedValue({ accountId: 'a1', role: 'member' })
    expect((await del()).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('admin arquiva: is_active false, sai de padrão e libera o slug; nada é apagado', async () => {
    g.resolveActiveSession.mockResolvedValue({ accountId: 'a1', role: 'admin' })
    const res = await del()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, newDefaultId: null })
    const [upd] = mock.callsTo('workspaces', 'update')
    expect(upd.payload).toEqual({ is_active: false, is_default: false, slug: 'unidade-w1-excluida-w1' })
    expect(filterValue(upd, 'eq', 'id')).toBe('w1')
    expect(filterValue(upd, 'eq', 'account_id')).toBe('a1')
    expect(mock.calls.filter((c) => c.op === 'delete')).toHaveLength(0)
  })

  it('unidade padrão: a próxima ativa vira padrão', async () => {
    setup([unit('w1', { is_default: true }), unit('w2', { is_active: false }), unit('w3')])
    const res = await del()

    expect(await res.json()).toEqual({ ok: true, newDefaultId: 'w3' })
    const updates = mock.callsTo('workspaces', 'update')
    expect(updates).toHaveLength(2)
    expect(updates[1].payload).toEqual({ is_default: true })
    expect(filterValue(updates[1], 'eq', 'id')).toBe('w3')
  })

  it('única unidade ativa → 400 e nada gravado', async () => {
    setup([unit('w1', { is_default: true }), unit('w2', { is_active: false })])
    const res = await del()

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(ARCHIVE_LAST_UNIT_ERROR)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it('com consultas futuras → 400 com a contagem e nada gravado', async () => {
    setup([unit('w1'), unit('w2')], 3)
    const res = await del()

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(archiveFutureAppointmentsError(3))
    const [q] = mock.callsTo('appointments', 'select')
    expect(filterValue(q, 'eq', 'workspace_id')).toBe('w1')
    expect(filterValue(q, 'in', 'status')).toEqual(['agendado', 'confirmado', 'pendente_confirmacao_externa'])
    expect(Math.abs(new Date(filterValue(q, 'gte', 'scheduled_at') as string).getTime() - Date.now())).toBeLessThan(5000)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it.each([
    ['de outra account', [unit('w2'), unit('w3')]],
    ['já excluída', [unit('w1', { is_active: false }), unit('w2')]],
  ])('unidade %s → 404', async (_label, units) => {
    setup(units)
    const res = await del()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe(ARCHIVE_NOT_FOUND_ERROR)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it('as mensagens chegam ao usuário sem virar o texto genérico', () => {
    expect(friendlyErrorMessage(ARCHIVE_LAST_UNIT_ERROR)).toBe(ARCHIVE_LAST_UNIT_ERROR)
    expect(friendlyErrorMessage(ARCHIVE_NOT_FOUND_ERROR)).toBe(ARCHIVE_NOT_FOUND_ERROR)
    expect(friendlyErrorMessage(archiveFutureAppointmentsError(1))).toBe(
      'A unidade tem 1 consulta marcada a partir de agora. Remarque ou cancele antes de excluir.'
    )
  })
})
