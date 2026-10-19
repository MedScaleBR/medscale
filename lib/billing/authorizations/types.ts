import type {
  TissAuthorizationEventType, TissAuthorizationItemKind, TissAuthorizationStatus, TissAuthorizationType,
} from '@/types/database'
import type {
  AusenciaCodValidacao, CaraterAtendimento, CoberturaEspecial, EtapaAutorizacao, IndicadorAcidente,
  OpcaoFabricante, RegimeInternacao, StatusSolicitacao, Tabela, TipoInternacao,
} from './domains'

export type AuthorizationType = TissAuthorizationType
export type AuthorizationStatus = TissAuthorizationStatus
export type AuthorizationItemKind = TissAuthorizationItemKind
export type AuthorizationEventType = TissAuthorizationEventType

// Snapshot (tiss_authorizations.payload). Congela operadora, contratado
// solicitante (unidade), profissional e beneficiário; "Recarregar dados"
// refaz o que vem das configurações. Tem carteirinha: nunca logar.
export interface AuthorizationProfessional {
  id: string | null // profiles.id escolhido
  name: string
  crm: string | null
  crm_uf: string | null
  cbo_code: string | null
  // R3: digitados na autorização, nunca lidos de profiles (o RPC não os expõe).
  phone: string | null // só dígitos (telefoneProfissional st_texto11; obrigatório no OPME)
  email: string | null
}

export interface AuthorizationPayloadBase {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  provider: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: AuthorizationProfessional
  // ct_beneficiarioDados: só carteira e atendimentoRN (nome/CNS saíram na 4.00.00).
  beneficiary: { patient_insurance_id: string | null; card_number: string | null; newborn: boolean }
}

// ausenciaCodValidacao?, codValidacao?, tipoEtapaAutorizacao [1] (SP/SADT e Internação)
export interface ValidationData {
  stage: EtapaAutorizacao
  absence_code: AusenciaCodValidacao | null
  code: string | null // st_texto10
}

export interface SpSadtRequestData extends ValidationData {
  character: CaraterAtendimento
  clinical_indication: string | null // st_texto500, opcional na SP/SADT
  special_coverage: CoberturaEspecial | null
  main_guide_number: string | null // numeroGuiaPrincipal st_texto20
  executor: { operator_code: string; cnes: string } | null // dadosExecutante (codigonaOperadora + CNES)
  observation: string | null // st_texto500
}

export interface HospitalizationRequestData extends ValidationData {
  character: CaraterAtendimento
  hospital: { operator_code: string | null; name: string | null; suggested_date: string | null }
  hospitalization_type: TipoInternacao
  regime: RegimeInternacao
  daily_count: number | null // st_numerico2 (1..99)
  opme_expected: boolean
  chemo_expected: boolean
  clinical_indication: string | null // obrigatória aqui (st_texto500)
  cid10: string[] // 0..4, sem ponto (st_texto4)
  accident: IndicadorAcidente
  observation: string | null // st_texto1000
}

export interface OpmeRequestData {
  technical_justification: string | null // obrigatória (st_texto1000)
  material_specification: string | null // st_texto500
  observation: string | null // "Observacao" st_texto500
}

export interface RequestDataByType {
  sp_sadt_request: SpSadtRequestData
  hospitalization_request: HospitalizationRequestData
  opme_request: OpmeRequestData
}

// `type` repete a coluna para o TypeScript estreitar o payload pelo tipo
// (o RPC confere que são iguais).
export type AuthorizationPayload<T extends AuthorizationType> = AuthorizationPayloadBase & {
  type: T
  request: RequestDataByType[T]
}
export type AnyAuthorizationPayload = { [K in AuthorizationType]: AuthorizationPayload<K> }[AuthorizationType]

export interface AuthorizationItemInput {
  table_code: Tabela
  code: string
  description: string
  quantity_requested: number
  manufacturer_option: OpcaoFabricante | null
  requested_value_cents: number | null
  anvisa_registration: string | null
  manufacturer_reference: string | null
  operating_authorization: string | null
}

export interface AuthorizationItem extends AuthorizationItemInput {
  id: string
  position: number
  kind: AuthorizationItemKind
  quantity_authorized: number | null
  authorized_value_cents: number | null
}

export type AuthorizationMissingField =
  | 'beneficiary.card_number'
  | 'provider.legal_name'
  | 'professional.name'
  | 'professional.crm'
  | 'professional.crm_uf'
  | 'professional.cbo_code'
  | 'professional.phone'
  | 'request.clinical_indication'
  | 'request.hospital.operator_code'
  | 'request.hospital.name'
  | 'request.hospital.suggested_date'
  | 'request.daily_count'
  | 'request.technical_justification'
  | 'items'

// Entrada dos geradores XML — nada de banco.
export interface AuthorizationXmlSource<T extends AuthorizationType> {
  type: T
  providerGuideNumber: string
  requestedAt: string // YYYY-MM-DD (dataSolicitacao)
  payload: AuthorizationPayload<T>
  items: AuthorizationItem[]
}
export type AnyAuthorizationXmlSource = { [K in AuthorizationType]: AuthorizationXmlSource<K> }[AuthorizationType]

export interface AuthorizationListRow {
  id: string
  workspace_id: string
  patient_id: string
  insurer_id: string
  appointment_id: string | null
  parent_id: string | null
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  missing_fields: string[]
  operator_guide_number: string | null
  response_status_code: StatusSolicitacao | null
  requested_at: string
  sent_at: string | null
  responded_at: string | null
  created_at: string
  updated_at: string // repassar como string (microssegundos)
  professional_name: string | null
  health_insurers: { name: string } | null
  patients: { full_name: string } | null
}

export interface AuthorizationRow extends AuthorizationListRow {
  payload: AnyAuthorizationPayload
  password: string | null
  authorization_date: string | null
  password_valid_until: string | null
}

export interface AuthorizationSummary {
  id: string
  type: AuthorizationType
  status: AuthorizationStatus
  provider_guide_number: string
  missing_fields: string[]
}

export interface AuthorizationDetail {
  authorization: AuthorizationRow
  items: AuthorizationItem[]
  parent: AuthorizationSummary | null
  children: AuthorizationSummary[]
}

export interface AuthorizationEventRow {
  id: number
  event: AuthorizationEventType
  from_status: AuthorizationStatus | null
  to_status: AuthorizationStatus | null
  actor_id: string | null
  created_at: string
}
