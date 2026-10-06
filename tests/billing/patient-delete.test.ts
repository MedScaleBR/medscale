import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => g.supabase.client }))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({ session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'admin', modules: [] } }),
}))

import { DELETE } from '@/app/api/patients/[id]/route'

const ctx = { params: Promise.resolve({ id: 'pa1' }) }
const del = () => DELETE(new NextRequest('https://app.test/api/patients/pa1', { method: 'DELETE' }), ctx)

describe('DELETE /api/patients/[id]', () => {
  beforeEach(() => { g.supabase = createSupabaseMock() })

  it('paciente com autorização TISS → 409 com mensagem em português, sem vazar o erro do banco', async () => {
    g.supabase = createSupabaseMock({ patients: { delete: { data: null, error: {
      code: '23503',
      message: 'update or delete on table "patients" violates foreign key constraint "tiss_authorizations_patient_id_fkey" on table "tiss_authorizations"',
    } } } })
    const res = await del()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Este paciente tem autorizações TISS e não pode ser excluído.' })
  })

  it('outras FKs (ex.: transcrições) e o caminho feliz não mudam', async () => {
    g.supabase = createSupabaseMock({ patients: { delete: { data: null, error: {
      code: '23503', message: 'violates foreign key constraint "transcriptions_patient_id_fkey"',
    } } } })
    expect((await del()).status).toBe(500)
    g.supabase = createSupabaseMock({ patients: { delete: { data: null, error: null } } })
    const ok = await del()
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    expect(g.supabase.callsTo('patients', 'delete')[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'pa1'], ['eq', 'account_id', 'acc1']]))
  })
})
