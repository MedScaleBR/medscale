import { describe, it, expect } from 'vitest'
import { createSupabaseMock, filterValue, type RecordedCall } from '../helpers/supabase-mock'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { generateAuthorizationXml, selectEmbeddedOpme } from '@/lib/billing/authorizations/xml'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { applyContentPatch, refreshPayload } from '@/lib/billing/authorizations/edit'
import { resolveCreateContext } from '@/lib/billing/authorizations/sources'
import { AUTH_SOURCES, fakeHospitalizationRequest, fakeOpmeAnnex, fakeSpSadtRequest, opmeItem, procedureItem } from '../tiss/authorization-fixtures'

const asClient = (m: ReturnType<typeof createSupabaseMock>) => m.client as unknown as SupabaseClient<Database>
const NOW = new Date('2026-10-05T15:00:00Z')

function row(source: { type: string; providerGuideNumber: string; requestedAt: string; payload: unknown }, over: Record<string, unknown> = {}) {
  return { id: `a${source.providerGuideNumber}`, type: source.type, status: 'ready', provider_guide_number: source.providerGuideNumber,
    requested_at: source.requestedAt, payload: source.payload, missing_fields: [], parent_id: null, ...over }
}

function xmlMock(rows: { main: ReturnType<typeof row>; children?: ReturnType<typeof row>[]; parent?: { provider_guide_number: string } }) {
  return createSupabaseMock({
    tiss_authorizations: {
      select: (call: RecordedCall) => {
        if (filterValue(call, 'eq', 'parent_id')) return { data: rows.children ?? [] }
        if (filterValue(call, 'eq', 'id') === rows.main.id) return { data: rows.main }
        return { data: rows.parent ?? null }
      },
    },
    tiss_authorization_items: {
      select: (call: RecordedCall) => {
        const id = filterValue(call, 'eq', 'authorization_id')
        return { data: String(id).startsWith('a43') ? [opmeItem(1)] : [procedureItem(1)] }
      },
    },
  })
}

describe('OPME embutido', () => {
  it('só com exatamente um OPME não cancelado', () => {
    expect(selectEmbeddedOpme([])).toBeNull()
    expect(selectEmbeddedOpme([{ status: 'cancelled' as const }, { status: 'ready' as const }])).toEqual({ status: 'ready' })
    expect(selectEmbeddedOpme([{ status: 'ready' as const }, { status: 'draft' as const }])).toBeNull()
  })
})

describe('generateAuthorizationXml', () => {
  it('rascunho → 409 sem gerar nem registrar evento', async () => {
    const m = xmlMock({ main: row(fakeSpSadtRequest(), { status: 'draft', missing_fields: ['items'] }) })
    expect(await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)).toMatchObject({ ok: false, status: 409 })
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('SP/SADT com um OPME pronto embute o anexo e registra o hash', async () => {
    const m = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex(), { parent_id: 'a41' })] })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect(r.xml.toString('latin1')).toContain('<ans:anexoClinico><ans:solicitacaoOPME>')
    expect(r.fileName).toBe('solicitacao-sp-sadt-41.xml')
    expect(m.rpc).toHaveBeenCalledWith('log_tiss_authorization_xml', { p_id: 'a41', p_hash: r.hash })
    expect(filterValue(m.callsTo('tiss_authorizations')[0], 'eq', 'account_id')).toBe('acc1')
  })

  it('internação com OPME ativo não embutido marca indicadorOPME = S sem o checkbox', async () => {
    const hosp = fakeHospitalizationRequest()
    hosp.payload.request.opme_expected = false
    const two = xmlMock({
      main: row(hosp),
      children: [
        row(fakeOpmeAnnex(), { parent_id: 'a42' }),
        row(fakeOpmeAnnex(), { id: 'a44', provider_guide_number: '44', parent_id: 'a42' }),
      ],
    })
    const r = await generateAuthorizationXml(asClient(two), 'acc1', 'a42', NOW)
    if (!r.ok) throw new Error(JSON.stringify(r))
    const xml = r.xml.toString('latin1')
    expect(xml).toContain('<ans:indicadorOPME>S</ans:indicadorOPME>')
    expect(xml).not.toContain('anexoClinico')

    const onlyCancelled = xmlMock({
      main: row(hosp),
      children: [row(fakeOpmeAnnex(), { status: 'cancelled', parent_id: 'a42' })],
    })
    const cancelled = await generateAuthorizationXml(asClient(onlyCancelled), 'acc1', 'a42', NOW)
    if (!cancelled.ok) throw new Error(JSON.stringify(cancelled))
    expect(cancelled.xml.toString('latin1')).toContain('<ans:indicadorOPME>N</ans:indicadorOPME>')
  })

  it('dois OPME ativos → não embute; um OPME incompleto → 409', async () => {
    const two = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex()), row(fakeOpmeAnnex(), { id: 'a44' })] })
    const r = await generateAuthorizationXml(asClient(two), 'acc1', 'a41', NOW)
    expect(r.ok && r.xml.toString('latin1')).not.toContain('anexoClinico')
    const draft = xmlMock({ main: row(fakeSpSadtRequest()), children: [row(fakeOpmeAnnex(), { status: 'draft', missing_fields: ['professional.phone'] })] })
    expect(await generateAuthorizationXml(asClient(draft), 'acc1', 'a41', NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('OPME avulso referencia o número do pai', async () => {
    const m = xmlMock({ main: row(fakeOpmeAnnex(), { parent_id: 'a41' }), parent: { provider_guide_number: '41' } })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a43', NOW)
    expect(r.ok && r.xml.toString('latin1')).toContain('<ans:numeroGuiaReferenciada>41</ans:numeroGuiaReferenciada>')
    expect(r.ok && r.fileName).toBe('anexo-opme-43.xml')
  })

  it('pronto mas sem itens → 409 (falha conhecida do montador)', async () => {
    const empty = createSupabaseMock({
      tiss_authorizations: { select: (call: RecordedCall) => ({ data: filterValue(call, 'eq', 'parent_id') ? [] : row(fakeSpSadtRequest(), { id: 'a41' }) }) },
      tiss_authorization_items: { select: { data: [] } },
    })
    expect(await generateAuthorizationXml(asClient(empty), 'acc1', 'a41', NOW)).toMatchObject({ ok: false, status: 409 })
    expect(empty.rpc).not.toHaveBeenCalled()
  })

  it('erro inesperado do montador não vira 409', async () => {
    const broken = row(fakeSpSadtRequest(), { payload: { type: 'sp_sadt_request' } })
    const m = xmlMock({ main: broken })
    await expect(generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)).rejects.toThrow(TypeError)
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('XML reprovado no XSD → 422 com erros sem valores', async () => {
    const source = fakeSpSadtRequest()
    source.payload.beneficiary.card_number = '9'.repeat(25)
    const m = xmlMock({ main: row(source) })
    const r = await generateAuthorizationXml(asClient(m), 'acc1', 'a41', NOW)
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(JSON.stringify(r)).not.toContain('9'.repeat(25))
    expect(m.rpc).not.toHaveBeenCalled()
  })
})

describe('erros de RPC', () => {
  it('mapeia pelas chaves exatas e não vaza mensagens desconhecidas', async () => {
    expect(authorizationRpcError({ message: 'tiss_authorization_changed' }).status).toBe(409)
    expect(authorizationRpcError({ message: 'tiss_authorization_forbidden', code: '42501' }).status).toBe(403)
    expect(authorizationRpcError({ message: 'billing_forbidden', code: '42501' }).status).toBe(403)
    expect(authorizationRpcError({ message: 'tiss_authorization_invalid_transition' }).status).toBe(409)
    expect(authorizationRpcError({ message: 'tiss_authorization_cancelled' }).status).toBe(409)
    expect(authorizationRpcError({ message: 'tiss_authorization_quantity' }).status).toBe(400)
    expect(authorizationRpcError({ message: 'tiss_authorization_not_ready' }).status).toBe(409)
    const unknown = authorizationRpcError({ message: 'duplicate key value violates ... FICT-CARD' })
    expect(unknown.status).toBe(500)
    expect(JSON.stringify(await unknown.json())).not.toContain('FICT-CARD')
    expect(authorizationRpcError({ message: 'x', code: '99999' }).status).toBe(500)
    expect(authorizationRpcError(null).status).toBe(500)
  })
})

describe('edição tipada', () => {
  it('aplica patch do pedido conforme o tipo e recusa campo de outro tipo', () => {
    const p = fakeSpSadtRequest().payload
    const r = applyContentPatch(p, { expected_updated_at: 'x', refresh: false, request: { observation: 'ok' }, card_number: 'NOVA' }, {})
    expect(r.ok && r.value.type === 'sp_sadt_request' && r.value.request.observation).toBe('ok')
    expect(r.ok && r.value.beneficiary.card_number).toBe('NOVA')
    expect(applyContentPatch(p, { expected_updated_at: 'x', refresh: false, request: { daily_count: 2 } }, {}).ok).toBe(false)
  })

  it('refresh preserva o pedido clínico', () => {
    const current = fakeOpmeAnnex().payload
    const fresh = refreshPayload(current, { ...AUTH_SOURCES, workspace: { ...AUTH_SOURCES.workspace, legal_name: 'Nova' } })
    expect(fresh.provider.legal_name).toBe('Nova')
    expect(fresh.type === 'opme_request' && fresh.request.technical_justification).toBe(current.request.technical_justification)
  })
})

describe('contexto de criação', () => {
  const SESSION = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'admin' as const, modules: [] }

  it('a partir do agendamento: unidade/paciente/operadora do agendamento e TUSS como primeiro item', async () => {
    const m = createSupabaseMock({
      appointments: { select: { data: { id: 'ap1', workspace_id: 'w2', patient_id: 'pa1', doctor_id: 'recepcao', insurer_id: 'in1', patient_insurance_id: 'pi1', insurer_procedure_id: 'pr1' } } },
      insurer_procedures: { select: { data: { tuss_code: '40301630', description: 'Hemograma' } } },
      health_insurers: { select: { data: AUTH_SOURCES.insurer } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [{ id: 'pi1', card_number: 'CARD-1', is_primary: true }] } },
    })
    m.rpc.mockResolvedValue({ data: [AUTH_SOURCES.professional], error: null })
    const r = await resolveCreateContext(asClient(m), SESSION, {
      type: 'sp_sadt_request', appointment_id: 'ap1', parent_id: null, patient_id: null, insurer_id: null,
      patient_insurance_id: null, professional_id: null,
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.context).toMatchObject({ workspaceId: 'w2', patientId: 'pa1', insurerId: 'in1', appointmentId: 'ap1' })
    expect(r.context.items).toEqual([expect.objectContaining({ table_code: '22', code: '40301630', quantity_requested: 1 })])
    // doctor_id do agendamento é quem agendou; só vira solicitante se estiver na lista de profissionais.
    expect(r.context.payload.professional.id).toBeNull()
    expect(r.context.payload.beneficiary.card_number).toBe('CARD-1')
    expect(m.rpc).toHaveBeenCalledWith('tiss_authorization_professionals', { p_workspace_id: 'w2' })
  })

  it('operadora sem ANS → 400 com a mensagem padrão', async () => {
    const m = createSupabaseMock({
      health_insurers: { select: { data: { ans_registry: null, provider_code: null, tiss_version: '4.03.00' } } },
      workspaces: { select: { data: AUTH_SOURCES.workspace } },
      patient_insurances: { select: { data: [] } },
    })
    m.rpc.mockResolvedValue({ data: [], error: null })
    const r = await resolveCreateContext(asClient(m), SESSION, {
      type: 'hospitalization_request', appointment_id: null, parent_id: null, patient_id: 'pa1', insurer_id: 'in1',
      patient_insurance_id: null, professional_id: null,
    })
    expect(r).toEqual({ ok: false, status: 400, error: 'Complete o registro ANS e o código do prestador desta operadora em Convênios.' })
  })
})
