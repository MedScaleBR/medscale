import { describe, it, expect } from 'vitest'
import { STATUS_SOLICITACAO, TABELA, isCode } from '@/lib/billing/authorizations/domains'
import {
  STATUS_FROM_RESPONSE, canCancel, canMarkSent, canRecordResponse, isEditable, statusForMissing,
} from '@/lib/billing/authorizations/status'
import { AUTHORIZATION_STATUS_LABELS } from '@/lib/billing/authorizations/constants'
import {
  applyAuthorizationEdits, buildAuthorizationPayload, defaultRequestData, mergeRefreshedAuthorizationPayload,
  type AuthorizationSources,
} from '@/lib/billing/authorizations/payload'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import {
  normalizeCid10, parseContentPatch, parseCreateBody, parseExpectedUpdatedAt, parseItems, parseRequestPatch, parseResponseBody,
} from '@/lib/billing/authorizations/validation'

describe('máquina de estados (espelha os RPCs)', () => {
  it('mapeia dm_statusSolicitacao como no design (D3)', () => {
    expect(STATUS_FROM_RESPONSE).toEqual({
      '1': 'authorized', '2': 'under_review', '3': 'denied', '4': 'pending_info',
      '5': 'pending_info', '6': 'cancelled', '7': 'partially_authorized',
    })
    expect(Object.keys(STATUS_SOLICITACAO)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('edição só em draft/ready; envio só de ready', () => {
    expect(isEditable('draft')).toBe(true)
    expect(isEditable('ready')).toBe(true)
    for (const s of ['sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied', 'cancelled'] as const) {
      expect(isEditable(s)).toBe(false)
      expect(canMarkSent(s)).toBe(false)
    }
    expect(canMarkSent('ready')).toBe(true)
    expect(canMarkSent('draft')).toBe(false)
  })

  it('cancela de draft até aguardando resposta; finais e cancelada nunca', () => {
    for (const s of ['draft', 'ready', 'sent', 'under_review', 'pending_info'] as const) expect(canCancel(s)).toBe(true)
    for (const s of ['authorized', 'partially_authorized', 'denied', 'cancelled'] as const) expect(canCancel(s)).toBe(false)
  })

  it('resposta depois do envio e, por R1, de novo em estado final; nunca de draft/ready/cancelled', () => {
    for (const s of ['sent', 'under_review', 'pending_info', 'authorized', 'partially_authorized', 'denied'] as const) {
      expect(canRecordResponse(s)).toBe(true)
    }
    for (const s of ['draft', 'ready', 'cancelled'] as const) expect(canRecordResponse(s)).toBe(false)
  })

  it('draft/ready por missing_fields', () => {
    expect(statusForMissing([])).toBe('ready')
    expect(statusForMissing(['items'])).toBe('draft')
  })

  it('domínios fechados: só códigos do XSD', () => {
    expect(isCode(TABELA, '19')).toBe(true)
    expect(isCode(TABELA, '21')).toBe(false)
    expect(isCode(TABELA, 'toString')).toBe(false)
    expect(Object.keys(AUTHORIZATION_STATUS_LABELS)).toHaveLength(9)
  })
})

const PROFESSIONAL = { id: 'p1', full_name: 'Dra. Maria', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125' }
const SOURCES: AuthorizationSources = {
  insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
  workspace: { cnes: '1234567', cnpj: '11222333000181', legal_name: ' Clínica Fictícia ' },
  professional: PROFESSIONAL,
  patientInsurance: { id: 'pi1', card_number: '00001111' },
}

describe('snapshot da autorização', () => {
  it('congela operadora, unidade, profissional e carteirinha; telefone/e-mail começam vazios (R3)', () => {
    const p = buildAuthorizationPayload('opme_request', SOURCES)
    expect(p).toMatchObject({
      type: 'opme_request',
      provider: { legal_name: 'Clínica Fictícia' },
      professional: { id: 'p1', name: 'Dra. Maria', crm: '123456/SP', phone: null, email: null },
      beneficiary: { patient_insurance_id: 'pi1', card_number: '00001111', newborn: false },
      request: { technical_justification: null },
    })
    // Digitado: só dígitos.
    expect(applyAuthorizationEdits(p, { professional_phone: '(11) 99999-0000' }).professional.phone).toBe('11999990000')
  })

  it('"Recarregar dados" troca configurações e preserva o digitado', () => {
    const current = applyAuthorizationEdits(buildAuthorizationPayload('hospitalization_request', SOURCES), {
      card_number: 'DIGITADA', professional_phone: '31988887777', newborn: true,
      request: { ...defaultRequestData('hospitalization_request'), clinical_indication: 'Dor abdominal' },
    })
    const fresh = buildAuthorizationPayload('hospitalization_request', {
      ...SOURCES,
      workspace: { ...SOURCES.workspace, legal_name: 'Razão Nova' },
      professional: { ...PROFESSIONAL, cbo_code: '225120' },
    })
    const merged = mergeRefreshedAuthorizationPayload(current, fresh)
    expect(merged.provider.legal_name).toBe('Razão Nova')
    expect(merged.professional.cbo_code).toBe('225120')
    expect(merged.professional.phone).toBe('31988887777')
    expect(merged.beneficiary).toEqual({ patient_insurance_id: 'pi1', card_number: 'DIGITADA', newborn: true })
    expect(merged.request.clinical_indication).toBe('Dor abdominal')
  })

  it('telefone digitado sobrevive ao mesmo profissional e some ao trocar de profissional', () => {
    const typed = applyAuthorizationEdits(buildAuthorizationPayload('opme_request', SOURCES), { professional_phone: '31988887777' })
    expect(applyAuthorizationEdits(typed, { professional: PROFESSIONAL }).professional.phone).toBe('31988887777')
    expect(applyAuthorizationEdits(typed, { professional: { ...PROFESSIONAL, id: 'p2' } }).professional.phone).toBeNull()
  })
})

describe('campos faltantes', () => {
  it('SP/SADT exige razão social, CRM/UF/CBO e itens', () => {
    const p = buildAuthorizationPayload('sp_sadt_request', { ...SOURCES, workspace: { cnes: null, cnpj: null, legal_name: null }, professional: null })
    expect(computeAuthorizationMissing(p, 0)).toEqual([
      'provider.legal_name', 'professional.crm', 'professional.crm_uf', 'professional.cbo_code', 'items',
    ])
  })

  it('Internação exige hospital, diárias e indicação clínica', () => {
    const p = buildAuthorizationPayload('hospitalization_request', SOURCES)
    expect(computeAuthorizationMissing(p, 1)).toEqual([
      'request.clinical_indication', 'request.hospital.operator_code', 'request.hospital.name',
      'request.hospital.suggested_date', 'request.daily_count',
    ])
  })

  it('OPME exige nome, telefone digitado válido e justificativa — não CRM', () => {
    const p = buildAuthorizationPayload('opme_request', { ...SOURCES, professional: { ...PROFESSIONAL, crm: null } })
    expect(computeAuthorizationMissing(p, 1)).toEqual(['professional.phone', 'request.technical_justification'])
    expect(computeAuthorizationMissing(applyAuthorizationEdits(p, { professional_phone: '123' }), 1))
      .toEqual(['professional.phone', 'request.technical_justification'])
    expect(computeAuthorizationMissing(applyAuthorizationEdits(p, { professional_phone: '31988887777' }), 1))
      .toEqual(['request.technical_justification'])
  })
})

describe('validação dos corpos', () => {
  it('expected_updated_at passa como string, sem perder microssegundos', () => {
    expect(parseExpectedUpdatedAt('2026-10-05T13:00:00.123456+00:00')).toEqual({ ok: true, value: '2026-10-05T13:00:00.123456+00:00' })
    expect(parseExpectedUpdatedAt(undefined).ok).toBe(false)
  })

  it('recusa texto acima do maxLength do XSD em vez de cortar; espaços viram null', () => {
    const r = parseRequestPatch('hospitalization_request', defaultRequestData('hospitalization_request'), { observation: 'x'.repeat(1001) })
    expect(r).toEqual({ ok: false, error: 'Observação: máximo de 1000 caracteres.' })
    const ok = parseRequestPatch('sp_sadt_request', defaultRequestData('sp_sadt_request'), { observation: '   ', clinical_indication: 'Anemia' })
    expect(ok.ok && ok.value.observation).toBeNull()
    expect(ok.ok && ok.value.clinical_indication).toBe('Anemia')
  })

  it('valida domínios, diárias, CIDs e hospital', () => {
    const base = defaultRequestData('hospitalization_request')
    expect(parseRequestPatch('hospitalization_request', base, { regime: '4' }).ok).toBe(false)
    expect(parseRequestPatch('hospitalization_request', base, { daily_count: 100 }).ok).toBe(false)
    expect(parseRequestPatch('hospitalization_request', base, { cid10: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(false)
    const r = parseRequestPatch('hospitalization_request', base, {
      cid10: ['k35.9', 'R10'], hospital: { operator_code: 'H1', name: 'Hospital', suggested_date: '2026-10-20' }, daily_count: 3,
    })
    expect(r.ok && r.value.cid10).toEqual(['K359', 'R10'])
    expect(r.ok && r.value.hospital).toEqual({ operator_code: 'H1', name: 'Hospital', suggested_date: '2026-10-20' })
    expect(normalizeCid10('Z00.00')).toBeNull()
    expect(parseRequestPatch('opme_request', defaultRequestData('opme_request'), { unknown: 1 }).ok).toBe(false)
  })

  it('itens: procedimento sem campos de OPME; OPME com opção de fabricante', () => {
    const proc = parseItems('sp_sadt_request', [{ table_code: '22', code: '40301010', description: 'Hemograma', quantity_requested: 1, manufacturer_option: '1' }])
    expect(proc.ok && proc.value[0].manufacturer_option).toBeNull()
    expect(parseItems('opme_request', [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 1 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '21', code: '1', description: 'X', quantity_requested: 1 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '22', code: '1', description: 'X', quantity_requested: 1000 }]).ok).toBe(false)
    expect(parseItems('sp_sadt_request', [{ table_code: '22', code: 'COD COM ESPACO', description: 'X', quantity_requested: 1 }]).ok).toBe(false)
    const opme = parseItems('opme_request', [{ table_code: '19', code: '7000', description: 'Placa', quantity_requested: 2,
      manufacturer_option: '2', requested_value_cents: 150000, anvisa_registration: '8000000001' }])
    expect(opme.ok && opme.value[0]).toMatchObject({ manufacturer_option: '2', requested_value_cents: 150000 })
  })

  it('criação: OPME exige pai; outros exigem agendamento ou paciente+operadora', () => {
    const uuid = '30000000-0000-0000-0000-000000000001'
    expect(parseCreateBody({ type: 'opme_request' }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request', parent_id: uuid }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request' }).ok).toBe(false)
    expect(parseCreateBody({ type: 'sp_sadt_request', appointment_id: uuid }).ok).toBe(true)
    expect(parseCreateBody({ type: 'hospitalization_request', patient_id: uuid, insurer_id: uuid }).ok).toBe(true)
    expect(parseCreateBody({ type: 'consulta', appointment_id: uuid }).ok).toBe(false)
  })

  it('conteúdo: carteirinha até 20, telefone 10–11 dígitos, e-mail até 60', () => {
    const at = '2026-10-05T13:00:00.123456+00:00'
    expect(parseContentPatch({ expected_updated_at: at, card_number: '1'.repeat(21) }).ok).toBe(false)
    expect(parseContentPatch({ expected_updated_at: at, professional_phone: '(31) 98888-7777' })).toEqual({
      ok: true, value: { expected_updated_at: at, refresh: false, professional_phone: '31988887777' },
    })
    expect(parseContentPatch({ expected_updated_at: at, professional_email: `${'a'.repeat(55)}@x.com` }).ok).toBe(false)
    expect(parseContentPatch({ action: 'refresh', expected_updated_at: at })).toEqual({ ok: true, value: { expected_updated_at: at, refresh: true } })
  })

  it('resposta: código do XSD, itens da própria autorização, valor só em OPME', () => {
    const at = '2026-10-05T13:00:00Z'
    const items = [{ id: 'a', kind: 'procedure' as const }, { id: 'b', kind: 'opme' as const }]
    expect(parseResponseBody({ expected_updated_at: at, status_code: '8' }, items).ok).toBe(false)
    expect(parseResponseBody({ expected_updated_at: at, status_code: '1', items: [{ id: 'z', quantity_authorized: 1, authorized_value_cents: null }] }, items).ok).toBe(false)
    expect(parseResponseBody({ expected_updated_at: at, status_code: '1', items: [{ id: 'a', quantity_authorized: null, authorized_value_cents: 10 }] }, items).ok).toBe(false)
    const r = parseResponseBody({ expected_updated_at: at, status_code: '7', operator_guide_number: ' OP1 ', password: 'S1',
      authorization_date: '2026-10-06', items: [{ id: 'b', quantity_authorized: 1, authorized_value_cents: 100 }] }, items)
    expect(r).toEqual({ ok: true, value: { expected_updated_at: at, status_code: '7', operator_guide_number: 'OP1', password: 'S1',
      authorization_date: '2026-10-06', password_valid_until: null, items: [{ id: 'b', quantity_authorized: 1, authorized_value_cents: 100 }] } })
  })
})

describe('resposta: itens explícitos (RPC sobrescreve com null o omitido)', () => {
  const at = '2026-10-05T13:00:00Z'
  const items = [{ id: 'a', kind: 'procedure' as const }, { id: 'b', kind: 'opme' as const }]
  const resp = (list: unknown[]) => parseResponseBody({ expected_updated_at: at, status_code: '1', items: list }, items)

  it('recusa ids repetidos', () => {
    expect(resp([{ id: 'a', quantity_authorized: 1, authorized_value_cents: null }, { id: 'a', quantity_authorized: 2, authorized_value_cents: null }]).ok).toBe(false)
  })
  it('exige as duas chaves; null explícito é aceito', () => {
    expect(resp([{ id: 'a', authorized_value_cents: null }]).ok).toBe(false)
    expect(resp([{ id: 'a', quantity_authorized: 1 }]).ok).toBe(false)
    expect(resp([{ id: 'a', quantity_authorized: null, authorized_value_cents: null }]).ok).toBe(true)
  })
  it('recusa negativos e não inteiros', () => {
    expect(resp([{ id: 'b', quantity_authorized: -1, authorized_value_cents: null }]).ok).toBe(false)
    expect(resp([{ id: 'b', quantity_authorized: 1.5, authorized_value_cents: null }]).ok).toBe(false)
    expect(resp([{ id: 'b', quantity_authorized: 1, authorized_value_cents: -5 }]).ok).toBe(false)
    expect(resp([{ id: 'b', quantity_authorized: 1, authorized_value_cents: 10.5 }]).ok).toBe(false)
  })
  it('valor autorizado em procedimento é recusado; em OPME passa', () => {
    expect(resp([{ id: 'a', quantity_authorized: 1, authorized_value_cents: 0 }]).ok).toBe(false)
    expect(resp([{ id: 'b', quantity_authorized: 1, authorized_value_cents: 0 }]).ok).toBe(true)
  })
})

describe('itens: nunca viola o CHECK do banco', () => {
  const base = { table_code: '19', code: '7000', description: 'Placa', quantity_requested: 1 }
  it('OPME exige opção de fabricante; procedimento zera campos de OPME', () => {
    expect(parseItems('opme_request', [base]).ok).toBe(false)
    expect(parseItems('opme_request', [{ ...base, manufacturer_option: '4' }]).ok).toBe(false)
    const proc = parseItems('sp_sadt_request', [{ ...base, table_code: '22', manufacturer_option: '1', requested_value_cents: 5, anvisa_registration: 'X', manufacturer_reference: 'Y', operating_authorization: 'Z' }])
    expect(proc.ok && proc.value[0]).toMatchObject({ manufacturer_option: null, requested_value_cents: null, anvisa_registration: null, manufacturer_reference: null, operating_authorization: null })
  })
})
