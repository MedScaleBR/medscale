import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock, type SupabaseMockConfig } from '../helpers/supabase-mock'
import { fakePayload } from '../tiss/fixtures'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  sentry: vi.fn(),
  tracked: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@sentry/nextjs', () => ({ captureException: g.sentry }))
vi.mock('@/lib/analytics/posthog-server', () => ({ trackBillingGuideCreated: g.tracked }))

import {
  applyGuideEdits,
  buildGuidePayload,
  computeMissingFields,
  ensureGuideForAppointment,
  ensureGuideSafely,
  mergeRefreshedPayload,
  statusForMissing,
  type GuideSources,
} from '@/lib/billing/guides'

// Dados fictícios. 30/09 01:30 UTC = 29/09 22:30 em São Paulo.
const APPOINTMENT = {
  id: 'ap1',
  account_id: 'acc1',
  workspace_id: 'w1',
  doctor_id: 'doc1',
  patient_id: 'pat1',
  patient_name: 'Paciente Fictício',
  scheduled_at: '2026-09-30T01:30:00Z',
  status: 'realizado',
  type: 'consulta',
  billing_type: 'convenio',
  insurer_id: 'ins1',
  patient_insurance_id: null as string | null,
  insurer_procedure_id: 'proc1',
  authorization_number: null,
  authorization_date: null,
}

const SOURCES: GuideSources = {
  appointment: APPOINTMENT as unknown as GuideSources['appointment'],
  insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00', default_consult_guide: 'consulta' },
  procedure: { tuss_code: '10101012', description: 'Consulta em consultório', price_cents: 15000, guide_type: 'consulta' },
  patientInsurance: { card_number: '0000111122223333', valid_until: null },
  patientName: 'Paciente Fictício',
  workspace: { cnes: '1234567', cnpj: null, legal_name: 'Clínica Fictícia Ltda' },
  professional: { full_name: 'Dra. Exemplo', crm: '123456', crm_uf: 'SP', cbo_code: '225125' },
  cid10: null,
}

describe('buildGuidePayload / computeMissingFields', () => {
  it('deve usar a data do atendimento no fuso de São Paulo', () => {
    expect(buildGuidePayload(SOURCES).service.date).toBe('2026-09-29')
  })

  it('deve tirar tipo de guia do procedimento e cair no padrão da operadora sem procedimento', () => {
    expect(buildGuidePayload({ ...SOURCES, procedure: { ...SOURCES.procedure!, guide_type: 'sp_sadt' } }).service.guide_type).toBe('sp_sadt')
    expect(
      buildGuidePayload({ ...SOURCES, procedure: null, insurer: { ...SOURCES.insurer, default_consult_guide: 'sp_sadt' } })
        .service.guide_type,
    ).toBe('sp_sadt')
  })

  it('deve marcar retorno como seguimento', () => {
    const src = { ...SOURCES, appointment: { ...SOURCES.appointment, type: 'retorno' as const } }
    expect(buildGuidePayload(src).service.is_return).toBe(true)
  })

  it('não deve apontar nada faltando numa guia completa', () => {
    const missing = computeMissingFields(buildGuidePayload(SOURCES))
    expect(missing).toEqual([])
    expect(statusForMissing(missing)).toBe('ready')
  })

  it('deve pedir a carteirinha quando a consulta não tem convênio do paciente', () => {
    const missing = computeMissingFields(buildGuidePayload({ ...SOURCES, patientInsurance: null }))
    expect(missing).toEqual(['beneficiary.card_number'])
    expect(statusForMissing(missing)).toBe('draft')
  })

  it('não deve exigir CID — o XSD 4.03.00 não tem esse campo nas guias', () => {
    expect(computeMissingFields(buildGuidePayload({ ...SOURCES, cid10: null }))).not.toContain('service.cid10')
  })

  it('deve validar CBO, UF e CNES e exigir razão social/descrição só na SP/SADT', () => {
    const payload = buildGuidePayload({
      ...SOURCES,
      procedure: { ...SOURCES.procedure!, guide_type: 'sp_sadt', description: '' },
      workspace: { cnes: '123', cnpj: null, legal_name: null },
      professional: { full_name: 'X', crm: 'CRM', crm_uf: 'XX', cbo_code: '2251' },
    })
    expect(computeMissingFields(payload).sort()).toEqual(
      [
        'professional.cbo_code',
        'professional.crm',
        'professional.crm_uf',
        'provider.cnes',
        'provider.legal_name',
        'service.description',
      ].sort(),
    )
  })

  it('deve pedir a data da autorização na SP/SADT quando há senha', () => {
    const payload = fakePayload({ guide_type: 'sp_sadt' })
    payload.service.authorization_number = 'SENHA1'
    expect(computeMissingFields(payload)).toEqual(['service.authorization_date'])
  })
})

describe('edição da guia', () => {
  it('deve promover para pronta quando a carteirinha é preenchida', () => {
    const draft = fakePayload({ card: '' })
    draft.beneficiary.card_number = null
    expect(computeMissingFields(draft)).toEqual(['beneficiary.card_number'])

    const edited = applyGuideEdits(draft, { card_number: ' 12345 ' })
    expect(edited.beneficiary.card_number).toBe('12345')
    expect(statusForMissing(computeMissingFields(edited))).toBe('ready')
    expect(draft.beneficiary.card_number).toBeNull() // não muta o original
  })

  it('deve trocar procedimento, valor e tipo de guia juntos', () => {
    const edited = applyGuideEdits(fakePayload(), {
      procedure: { tuss_code: '40304361', description: 'Hemograma', price_cents: 2500, guide_type: 'sp_sadt' },
    })
    expect(edited.service).toMatchObject({ tuss_code: '40304361', price_cents: 2500, guide_type: 'sp_sadt' })
  })

  it('recarregar deve puxar dados novos do médico sem perder o que foi digitado na guia', () => {
    const current = fakePayload()
    current.professional.cbo_code = null
    current.beneficiary.card_number = 'DIGITADA'
    const fresh = fakePayload()
    fresh.beneficiary.card_number = null
    fresh.professional.cbo_code = '225125'

    const merged = mergeRefreshedPayload(current, fresh)
    expect(merged.professional.cbo_code).toBe('225125')
    expect(merged.beneficiary.card_number).toBe('DIGITADA')
  })
})

describe('ensureGuideForAppointment', () => {
  function setup(overrides: SupabaseMockConfig = {}, appointment: Record<string, unknown> = {}) {
    g.supabase = createSupabaseMock({
      appointments: { select: { data: { ...APPOINTMENT, ...appointment } } },
      tiss_guides: { select: { data: null }, insert: { data: { id: 'guide1' } } },
      accounts: { select: { data: { modules: ['billing'] } } },
      insurer_procedures: {
        select: { data: { insurer_id: 'ins1', tuss_code: '10101012', description: 'Consulta', price_cents: 15000, guide_type: 'consulta' } },
      },
      patient_insurances: { select: { data: null } },
      health_insurers: {
        select: { data: { ans_registry: '999999', provider_code: 'P1', tiss_version: '4.03.00', default_consult_guide: 'consulta' } },
      },
      workspaces: { select: { data: { cnes: '1234567', cnpj: null, legal_name: 'Clínica' } } },
      profiles: { select: { data: { full_name: 'Dra. Exemplo', crm: '123456', crm_uf: 'SP', cbo_code: '225125' } } },
      patients: { select: { data: { full_name: 'Paciente Fictício' } } },
      transcriptions: { select: { data: null } },
      ...overrides,
    })
    g.supabase.rpc.mockResolvedValue({ data: 42, error: null })
    return g.supabase
  }

  beforeEach(() => {
    setup()
  })

  it('não deve gerar guia para consulta particular', async () => {
    setup({}, { billing_type: 'particular' })
    const result = await ensureGuideForAppointment('ap1', g.supabase.client as never)

    expect(result).toEqual({ status: 'skipped', reason: 'not_convenio' })
    expect(g.supabase.callsTo('tiss_guides', 'insert')).toHaveLength(0)
    expect(g.supabase.rpc).not.toHaveBeenCalled()
  })

  it('não deve gerar guia antes da consulta ser realizada', async () => {
    setup({}, { status: 'confirmado' })
    expect(await ensureGuideForAppointment('ap1', g.supabase.client as never)).toEqual({ status: 'skipped', reason: 'not_realizado' })
  })

  it('não deve gerar guia com o módulo billing desligado', async () => {
    setup({ accounts: { select: { data: { modules: ['agenda'] } } } })
    expect(await ensureGuideForAppointment('ap1', g.supabase.client as never)).toEqual({ status: 'skipped', reason: 'module_off' })
  })

  it('deve criar guia rascunho com a carteirinha em missing_fields quando falta o convênio do paciente', async () => {
    const result = await ensureGuideForAppointment('ap1', g.supabase.client as never)

    expect(result).toEqual({ status: 'created', guideId: 'guide1', guideStatus: 'draft' })
    const [insert] = g.supabase.callsTo('tiss_guides', 'insert')
    expect(insert.payload).toMatchObject({
      account_id: 'acc1',
      appointment_id: 'ap1',
      insurer_id: 'ins1',
      status: 'draft',
      missing_fields: ['beneficiary.card_number'],
      provider_guide_number: '42',
      service_date: '2026-09-29',
      total_cents: 15000,
    })
    expect(g.supabase.rpc).toHaveBeenCalledWith('next_tiss_number', { p_insurer_id: 'ins1', p_kind: 'guide' })
    expect(g.tracked).toHaveBeenCalledWith('acc1', { guide_type: 'consulta', has_missing_fields: true })
  })

  it('deve criar guia pronta com o CID do prontuário assinado', async () => {
    setup(
      {
        patient_insurances: { select: { data: { insurer_id: 'ins1', card_number: '0000111122223333', valid_until: null } } },
        transcriptions: { select: { data: { medical_record_final: { soap: { A: { cid10: 'J06.9' } } } } } },
      },
      { patient_insurance_id: 'pi1' },
    )
    const result = await ensureGuideForAppointment('ap1', g.supabase.client as never)

    expect(result).toMatchObject({ status: 'created', guideStatus: 'ready' })
    const [insert] = g.supabase.callsTo('tiss_guides', 'insert')
    const payload = (insert.payload as { payload: { service: { cid10: string } } }).payload
    expect(payload.service.cid10).toBe('J06.9')
    const [tx] = g.supabase.callsTo('transcriptions', 'select')
    expect(tx.filters).toContainEqual(['eq', 'status', 'signed'])
  })

  it('deve ignorar carteirinha de outra operadora', async () => {
    setup(
      { patient_insurances: { select: { data: { insurer_id: 'OUTRA', card_number: '999', valid_until: null } } } },
      { patient_insurance_id: 'pi1' },
    )
    await ensureGuideForAppointment('ap1', g.supabase.client as never)
    const [insert] = g.supabase.callsTo('tiss_guides', 'insert')
    expect((insert.payload as { missing_fields: string[] }).missing_fields).toContain('beneficiary.card_number')
  })

  it('deve ser idempotente quando a guia já existe', async () => {
    setup({ tiss_guides: { select: { data: { id: 'existing' } } } })
    expect(await ensureGuideForAppointment('ap1', g.supabase.client as never)).toEqual({ status: 'exists', guideId: 'existing' })
    expect(g.supabase.rpc).not.toHaveBeenCalled()
  })

  it('deve tratar corrida no INSERT (UNIQUE appointment_id) como guia existente', async () => {
    setup({
      tiss_guides: {
        select: [{ data: null }, { data: { id: 'raced' } }],
        insert: { data: null, error: { code: '23505', message: 'duplicate' } },
      },
    })
    expect(await ensureGuideForAppointment('ap1', g.supabase.client as never)).toEqual({ status: 'exists', guideId: 'raced' })
  })

  it('duas guias devem receber os números que a função SQL atômica devolver', async () => {
    g.supabase.rpc.mockResolvedValueOnce({ data: 7, error: null }).mockResolvedValueOnce({ data: 8, error: null })
    await Promise.all([ensureGuideForAppointment('ap1', g.supabase.client as never), ensureGuideForAppointment('ap1', g.supabase.client as never)])

    const numbers = g.supabase.callsTo('tiss_guides', 'insert').map((c) => (c.payload as { provider_guide_number: string }).provider_guide_number)
    expect(numbers.sort()).toEqual(['7', '8'])
  })
})

describe('ensureGuideSafely', () => {
  it('não deve propagar erro e deve reportar ao Sentry só com IDs', async () => {
    g.supabase = createSupabaseMock({
      appointments: { select: { data: APPOINTMENT } },
      tiss_guides: { select: { data: null } },
      accounts: { select: { data: { modules: ['billing'] } } },
      health_insurers: { select: { data: { ans_registry: '999999', provider_code: 'P1', tiss_version: '4.03.00', default_consult_guide: 'consulta' } } },
      workspaces: { select: { data: { cnes: null, cnpj: null, legal_name: null } } },
      patients: { select: { data: { full_name: 'Paciente Secreto' } } },
      patient_insurances: { select: { data: { insurer_id: 'ins1', card_number: 'CARD-SECRETO-123', valid_until: null } } },
    })
    g.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(ensureGuideSafely('ap1', g.supabase.client as never)).resolves.toBeUndefined()

    expect(g.sentry).toHaveBeenCalledTimes(1)
    const reported = JSON.stringify(g.sentry.mock.calls[0])
    expect(reported).toContain('ap1')
    expect(reported).not.toContain('CARD-SECRETO-123')
    expect(reported).not.toContain('Paciente Secreto')
  })
})
