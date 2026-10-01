import type { MissingField } from './types'

export const BILLING_TZ = 'America/Sao_Paulo'

// Versões TISS com gerador implementado (lib/tiss/v<versão>/). Uma versão nova
// entra aqui e em lib/billing/batches.ts#TISS_VERSIONS.
export const SUPPORTED_TISS_VERSIONS = ['4.03.00'] as const

export const BRAZIL_UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  'beneficiary.card_number': 'Carteirinha do paciente',
  'provider.cnes': 'CNES da unidade',
  'provider.legal_name': 'Razão social da unidade',
  'professional.crm': 'CRM do médico',
  'professional.crm_uf': 'UF do CRM',
  'professional.cbo_code': 'CBO do médico',
  'service.tuss_code': 'Procedimento TUSS',
  'service.description': 'Descrição do procedimento',
  'service.authorization_date': 'Data da autorização',
}

// Campos que só se corrigem nas configurações — a tela da guia aponta para lá
// e depois o "Recarregar dados" puxa o valor novo.
export const SETTINGS_FIELDS: MissingField[] = [
  'provider.cnes',
  'provider.legal_name',
  'professional.crm',
  'professional.crm_uf',
  'professional.cbo_code',
]

// Colunas de tiss_guides devolvidas às telas de /faturamento.
export const GUIDE_COLUMNS =
  'id, appointment_id, insurer_id, batch_id, guide_type, provider_guide_number, status, payload, missing_fields, ' +
  'total_cents, service_date, created_at, updated_at, health_insurers(name)'

// Colunas de tiss_batches devolvidas ao client — xml_path fica de fora sempre.
export const BATCH_COLUMNS =
  'id, insurer_id, batch_number, tiss_version, guide_type, status, hash_md5, guide_count, total_cents, ' +
  'error_message, created_by, sent_at, sent_by, created_at, health_insurers(name)'

export const GUIDE_TYPE_LABELS = { consulta: 'Consulta', sp_sadt: 'SP/SADT' } as const
