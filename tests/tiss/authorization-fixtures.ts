import { buildAuthorizationPayload, type AuthorizationSources } from '@/lib/billing/authorizations/payload'
import type { AuthorizationItem, AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// Dados 100% fictícios — ANS, CNES, CRM, carteirinha e ANVISA inventados.
export const AUTH_SOURCES: AuthorizationSources = {
  insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
  workspace: { cnes: '1234567', cnpj: '11222333000181', legal_name: 'Clínica Fictícia São João Ltda' },
  // R3: a lista de profissionais não traz telefone/e-mail.
  professional: { id: 'p1', full_name: 'Dra. Maria Exemplo', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125' },
  patientInsurance: { id: 'pi1', card_number: '00001111222233334' },
}

export function procedureItem(n: number): AuthorizationItem {
  return {
    id: `i${n}`, position: n, kind: 'procedure', table_code: '22', code: String(40300000 + n),
    description: `Procedimento fictício ${n}`, quantity_requested: 1, quantity_authorized: null,
    authorized_value_cents: null, manufacturer_option: null, requested_value_cents: null,
    anvisa_registration: null, manufacturer_reference: null, operating_authorization: null,
  }
}

export function opmeItem(n: number, over: Partial<AuthorizationItem> = {}): AuthorizationItem {
  return {
    ...procedureItem(n), id: `o${n}`, kind: 'opme', table_code: '19', code: String(70000000 + n),
    description: `Material OPME fictício ${n}`, quantity_requested: 2, manufacturer_option: '1',
    requested_value_cents: 150000, anvisa_registration: '80000000001', manufacturer_reference: 'REF-ABC-1',
    operating_authorization: 'AFE-123', ...over,
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export function fakeSpSadtRequest(itemCount = 2): AuthorizationXmlSource<'sp_sadt_request'> {
  const payload = buildAuthorizationPayload('sp_sadt_request', AUTH_SOURCES)
  payload.request.clinical_indication = 'Investigação de anemia'
  return { type: 'sp_sadt_request', providerGuideNumber: '41', requestedAt: '2026-10-05', payload, items: range(itemCount).map(procedureItem) }
}

export function fakeHospitalizationRequest(itemCount = 1): AuthorizationXmlSource<'hospitalization_request'> {
  const payload = buildAuthorizationPayload('hospitalization_request', AUTH_SOURCES)
  payload.request.hospital = { operator_code: 'HOSP0001', name: 'Hospital Fictício', suggested_date: '2026-10-20' }
  payload.request.hospitalization_type = '2'
  payload.request.daily_count = 3
  payload.request.clinical_indication = 'Apendicite aguda'
  payload.request.cid10 = ['K359']
  return { type: 'hospitalization_request', providerGuideNumber: '42', requestedAt: '2026-10-05', payload, items: range(itemCount).map(procedureItem) }
}

export function fakeOpmeAnnex(itemCount = 1): AuthorizationXmlSource<'opme_request'> {
  const payload = buildAuthorizationPayload('opme_request', AUTH_SOURCES)
  // Digitados no formulário OPME (R3).
  payload.professional.phone = '11999990000'
  payload.professional.email = 'maria@exemplo.test'
  payload.request.technical_justification = 'Fratura de tíbia com indicação de fixação interna.'
  return { type: 'opme_request', providerGuideNumber: '43', requestedAt: '2026-10-05', payload, items: range(itemCount).map((n) => opmeItem(n)) }
}
