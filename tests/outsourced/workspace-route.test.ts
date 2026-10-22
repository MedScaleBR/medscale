import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import { OUTSOURCED_PHONE_INVALID_ERROR, OUTSOURCED_PHONE_REQUIRED_ERROR } from '@/lib/outsourced/config'

const g = vi.hoisted(() => ({
  supabase: null as unknown,
  resolveActiveSession: vi.fn(),
}))

vi.mock('@/lib/session/server', () => ({ resolveActiveSession: g.resolveActiveSession }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => (g.supabase as SupabaseMock).client,
}))

import { PATCH } from '@/app/api/workspaces/[id]/route'

let mock: SupabaseMock

function setup(current = { is_outsourced: false, external_clinic_phone: null as string | null }) {
  mock = createSupabaseMock({
    workspaces: {
      select: { data: current, error: null },
      update: { data: { id: 'w1' }, error: null },
    },
  })
  g.supabase = mock
}

function patch(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost/api/workspaces/w1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return PATCH(req, { params: Promise.resolve({ id: 'w1' }) })
}

describe('PATCH /api/workspaces/[id] — agendamento terceirizado', () => {
  beforeEach(() => {
    g.resolveActiveSession.mockReset()
    g.resolveActiveSession.mockResolvedValue({ accountId: 'a1', role: 'owner' })
    setup()
  })

  it('member recebe 403', async () => {
    g.resolveActiveSession.mockResolvedValue({ accountId: 'a1', role: 'member' })
    const res = await patch({ is_outsourced: true })
    expect(res.status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('ligar sem telefone na unidade devolve 400 e não atualiza', async () => {
    const res = await patch({ is_outsourced: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(OUTSOURCED_PHONE_REQUIRED_ERROR)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it('ligar com telefone grava o número normalizado', async () => {
    const res = await patch({ is_outsourced: true, external_clinic_phone: '(71) 99999-0000' })
    expect(res.status).toBe(200)
    const [upd] = mock.callsTo('workspaces', 'update')
    expect(upd.payload).toEqual({ is_outsourced: true, external_clinic_phone: '5571999990000' })
  })

  it('telefone inválido devolve 400', async () => {
    const res = await patch({ external_clinic_phone: 'abc' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(OUTSOURCED_PHONE_INVALID_ERROR)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it('body sem os campos não toca neles nem faz select extra', async () => {
    const res = await patch({ name: 'Unidade' })
    expect(res.status).toBe(200)
    const [upd] = mock.callsTo('workspaces', 'update')
    expect(upd.payload).not.toHaveProperty('is_outsourced')
    expect(upd.payload).not.toHaveProperty('external_clinic_phone')
    expect(mock.callsTo('workspaces', 'select')).toHaveLength(0)
  })

  it('is_default com telefone inválido devolve 400 sem atualizar nenhuma unidade', async () => {
    const res = await patch({ is_default: true, external_clinic_phone: 'abc' })
    expect(res.status).toBe(400)
    expect(mock.callsTo('workspaces', 'update')).toHaveLength(0)
  })

  it('is_default válido ainda desmarca as outras antes de gravar', async () => {
    const res = await patch({ is_default: true })
    expect(res.status).toBe(200)
    const updates = mock.callsTo('workspaces', 'update')
    expect(updates[0].payload).toEqual({ is_default: false })
    expect(updates[1].payload).toEqual({ is_default: true })
  })

  it('as mensagens de erro chegam ao usuário sem virar o texto genérico', () => {
    expect(friendlyErrorMessage(OUTSOURCED_PHONE_INVALID_ERROR)).toBe(OUTSOURCED_PHONE_INVALID_ERROR)
    expect(friendlyErrorMessage(OUTSOURCED_PHONE_REQUIRED_ERROR)).toBe(OUTSOURCED_PHONE_REQUIRED_ERROR)
  })
})
