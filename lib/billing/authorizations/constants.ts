import type { AuthorizationMissingField, AuthorizationStatus, AuthorizationType } from './types'

export const AUTHORIZATION_TYPE_LABELS: Record<AuthorizationType, string> = {
  sp_sadt_request: 'SP/SADT',
  hospitalization_request: 'Internação',
  opme_request: 'Anexo OPME',
}

export const AUTHORIZATION_STATUS_LABELS: Record<AuthorizationStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  sent: 'Enviada',
  under_review: 'Em análise',
  pending_info: 'Pendente de informação',
  authorized: 'Autorizada',
  partially_authorized: 'Autorizada parcialmente',
  denied: 'Negada',
  cancelled: 'Cancelada',
}

export const AUTHORIZATION_MISSING_LABELS: Record<AuthorizationMissingField, string> = {
  'beneficiary.card_number': 'Carteirinha do paciente',
  'provider.legal_name': 'Razão social da unidade',
  'professional.name': 'Nome do profissional solicitante',
  'professional.crm': 'CRM do profissional',
  'professional.crm_uf': 'UF do CRM',
  'professional.cbo_code': 'CBO do profissional',
  'professional.phone': 'Telefone do profissional (DDD + número)',
  'request.clinical_indication': 'Indicação clínica',
  'request.hospital.operator_code': 'Código do hospital na operadora',
  'request.hospital.name': 'Nome do hospital',
  'request.hospital.suggested_date': 'Data sugerida da internação',
  'request.daily_count': 'Quantidade de diárias',
  'request.technical_justification': 'Justificativa técnica',
  items: 'Ao menos um item',
}

// Corrigidos só nas configurações (unidade/perfil); depois "Recarregar dados".
export const AUTHORIZATION_SETTINGS_FIELDS: AuthorizationMissingField[] = [
  'provider.legal_name',
  'professional.crm',
  'professional.crm_uf',
  'professional.cbo_code',
]

// O XSD não limita os itens; o limite é de usabilidade (papel: 12/6 linhas).
export const MAX_AUTHORIZATION_ITEMS = 50
// st_decimal10-2: até 99.999.999,99.
export const MAX_VALUE_CENTS = 9_999_999_999

// Colunas de tiss_authorizations para as telas. Concatenadas (como
// GUIDE_COLUMNS), então o resultado do select é convertido com cast.
export const AUTHORIZATION_LIST_COLUMNS =
  'id, workspace_id, patient_id, insurer_id, appointment_id, parent_id, type, status, provider_guide_number, ' +
  'missing_fields, operator_guide_number, response_status_code, requested_at, sent_at, responded_at, created_at, ' +
  'updated_at, professional_name:payload->professional->>name, health_insurers(name), patients(full_name)'

export const AUTHORIZATION_COLUMNS =
  AUTHORIZATION_LIST_COLUMNS + ', payload, password, authorization_date, password_valid_until'

export const AUTHORIZATION_ITEM_COLUMNS =
  'id, position, kind, table_code, code, description, quantity_requested, quantity_authorized, manufacturer_option, ' +
  'requested_value_cents, authorized_value_cents, anvisa_registration, manufacturer_reference, operating_authorization'

export const AUTHORIZATION_SUMMARY_COLUMNS = 'id, type, status, provider_guide_number, missing_fields'
