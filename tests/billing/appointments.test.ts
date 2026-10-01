import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  ensureGuide: vi.fn(),
  applyRevenue: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({
    session: { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'member', modules: ['agenda'] },
  }),
}))
vi.mock('@/lib/google/calendar', () => ({ cancelEvent: vi.fn(), updateEvent: vi.fn() }))
vi.mock('@/lib/revenue/cycle', () => ({
  applyAppointmentRevenue: g.applyRevenue,
  syncRevenueEntryToAppointmentStatus: vi.fn(),
}))
vi.mock('@/lib/billing/guides', () => ({ ensureGuideSafely: g.ensureGuide }))

import { resolveAppointmentBilling } from '@/lib/billing/appointments'
import { PATCH } from '@/app/api/appointments/[id]/route'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    accounts: { select: { data: { modules: ['billing'] } } },
    health_insurers: { select: { data: { id: 'ins1', name: 'Operadora Fictícia' } } },
    patient_insurances: { select: { data: { id: 'pi1' } } },
    insurer_procedures: { select: { data: { id: 'proc1' } } },
    ...config,
  })
}

const client = () => g.supabase.client as never

describe('resolveAppointmentBilling', () => {
  beforeEach(() => setup())

  it('sem billing_type no corpo não mexe no faturamento', async () => {
    expect(await resolveAppointmentBilling(client(), { accountId: 'acc1', patientId: null, body: {} })).toEqual({
      ok: true,
      fields: null,
    })
  })

  it('com o módulo desligado ignora os campos — a consulta segue como hoje', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } } })
    const r = await resolveAppointmentBilling(client(), {
      accountId: 'acc1',
      patientId: null,
      body: { billing_type: 'convenio', insurer_id: 'ins1' },
    })
    expect(r).toEqual({ ok: true, fields: null })
  })

  it('convênio grava a operadora e usa o nome dela como health_plan (fora do ciclo de receita)', async () => {
    const r = await resolveAppointmentBilling(client(), {
      accountId: 'acc1',
      patientId: 'pat1',
      body: {
        billing_type: 'convenio',
        insurer_id: 'ins1',
        patient_insurance_id: 'pi1',
        insurer_procedure_id: 'proc1',
        authorization_number: ' SENHA1 ',
        authorization_date: '2026-09-20',
      },
    })
    expect(r).toEqual({
      ok: true,
      fields: {
        billing_type: 'convenio',
        insurer_id: 'ins1',
        patient_insurance_id: 'pi1',
        insurer_procedure_id: 'proc1',
        authorization_number: 'SENHA1',
        authorization_date: '2026-09-20',
        health_plan: 'Operadora Fictícia',
      },
    })
    const [card] = g.supabase.callsTo('patient_insurances', 'select')
    expect(card.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'insurer_id', 'ins1'],
        ['eq', 'patient_id', 'pat1'],
      ]),
    )
  })

  it('convênio sem carteirinha nem procedimento é aceito (a guia sai em rascunho)', async () => {
    const r = await resolveAppointmentBilling(client(), {
      accountId: 'acc1',
      patientId: null,
      body: { billing_type: 'convenio', insurer_id: 'ins1' },
    })
    expect(r.ok && r.fields).toMatchObject({ patient_insurance_id: null, insurer_procedure_id: null })
  })

  it('deve recusar operadora de outra account e carteirinha de outra operadora', async () => {
    setup({ health_insurers: { select: { data: null } } })
    expect(
      (await resolveAppointmentBilling(client(), { accountId: 'acc1', patientId: null, body: { billing_type: 'convenio', insurer_id: 'x' } })).ok,
    ).toBe(false)

    setup({ patient_insurances: { select: { data: null } } })
    const r = await resolveAppointmentBilling(client(), {
      accountId: 'acc1',
      patientId: 'pat1',
      body: { billing_type: 'convenio', insurer_id: 'ins1', patient_insurance_id: 'pi-outra' },
    })
    expect(r).toEqual({ ok: false, error: 'Carteirinha não pertence a este paciente/convênio.' })
  })

  it('particular limpa todos os campos de convênio', async () => {
    const r = await resolveAppointmentBilling(client(), { accountId: 'acc1', patientId: null, body: { billing_type: 'particular' } })
    expect(r).toEqual({
      ok: true,
      fields: {
        billing_type: 'particular',
        insurer_id: null,
        patient_insurance_id: null,
        insurer_procedure_id: null,
        authorization_number: null,
        authorization_date: null,
        health_plan: null,
      },
    })
  })
})

describe('PATCH /api/appointments/[id] — geração de guia', () => {
  const current = {
    id: 'ap1',
    workspace_id: 'w1',
    account_id: 'acc1',
    patient_id: 'pat1',
    status: 'confirmado',
    gcal_event_id: null,
    health_plan: null,
    procedure_id: null,
    duration_min: 30,
    scheduled_at: '2026-09-29T13:00:00Z',
  }

  const patch = (body: unknown) =>
    PATCH(
      new Request('https://app.test/api/appointments/ap1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ id: 'ap1' }) },
    )

  it('marcar consulta de convênio como realizada gera a guia', async () => {
    setup({
      appointments: {
        select: { data: current },
        update: { data: { ...current, status: 'realizado', billing_type: 'convenio', health_plan: 'Operadora Fictícia' } },
      },
    })

    const res = await patch({ status: 'realizado', billing_type: 'convenio', insurer_id: 'ins1' })

    expect(res.status).toBe(200)
    expect(g.ensureGuide).toHaveBeenCalledWith('ap1')
    const [update] = g.supabase.callsTo('appointments', 'update')
    expect(update.payload).toMatchObject({
      status: 'realizado',
      billing_type: 'convenio',
      insurer_id: 'ins1',
      health_plan: 'Operadora Fictícia',
      price: null,
      procedure_id: null,
    })
  })

  it('consulta particular marcada como realizada não gera guia', async () => {
    setup({
      appointments: {
        select: { data: current },
        update: { data: { ...current, status: 'realizado', billing_type: 'particular' } },
      },
    })

    await patch({ status: 'realizado' })

    expect(g.ensureGuide).not.toHaveBeenCalled()
    const [update] = g.supabase.callsTo('appointments', 'update')
    expect(update.payload).not.toHaveProperty('billing_type')
  })

  it('carteirinha inválida devolve 400 sem gravar nada', async () => {
    setup({ appointments: { select: { data: current } }, patient_insurances: { select: { data: null } } })

    const res = await patch({ billing_type: 'convenio', insurer_id: 'ins1', patient_insurance_id: 'pi-x' })

    expect(res.status).toBe(400)
    expect(g.supabase.callsTo('appointments', 'update')).toHaveLength(0)
  })
})
