import type {
  AuthorizationPayload, AuthorizationProfessional, AuthorizationType, RequestDataByType,
} from './types'

// Linha de tiss_authorization_professionals. R3: sem telefone/e-mail — no
// payload eles são sempre digitados (AuthorizationEdits.professional_phone/email).
export interface ProfessionalOption {
  id: string
  full_name: string
  crm: string | null
  crm_uf: string | null
  cbo_code: string | null
}

export interface AuthorizationSources {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  workspace: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: ProfessionalOption | null
  patientInsurance: { id: string; card_number: string } | null
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '') || null

// Valores iniciais. tipoEtapaAutorizacao é obrigatório no XSD e não existe no
// formulário em papel: começa em "1 - autorização prévia". Caráter eletivo e
// "não acidente" como nas guias. O resto começa vazio e vira missing_fields.
const DEFAULT_REQUEST: RequestDataByType = {
  sp_sadt_request: {
    stage: '1', absence_code: null, code: null, character: '1', clinical_indication: null,
    special_coverage: null, main_guide_number: null, executor: null, observation: null,
  },
  hospitalization_request: {
    stage: '1', absence_code: null, code: null, character: '1',
    hospital: { operator_code: null, name: null, suggested_date: null },
    hospitalization_type: '1', regime: '1', daily_count: null, opme_expected: false, chemo_expected: false,
    clinical_indication: null, cid10: [], accident: '9', observation: null,
  },
  opme_request: { technical_justification: null, material_specification: null, observation: null },
}

export function defaultRequestData<T extends AuthorizationType>(type: T): RequestDataByType[T] {
  return structuredClone(DEFAULT_REQUEST[type])
}

// Telefone/e-mail começam vazios: não vêm do cadastro (R3).
export function professionalSnapshot(p: ProfessionalOption | null): AuthorizationProfessional {
  return {
    id: p?.id ?? null,
    name: p?.full_name.trim() ?? '',
    crm: blank(p?.crm),
    crm_uf: blank(p?.crm_uf),
    cbo_code: blank(p?.cbo_code),
    phone: null,
    email: null,
  }
}

export function buildAuthorizationPayload<T extends AuthorizationType>(
  type: T,
  src: AuthorizationSources,
  request: RequestDataByType[T] = defaultRequestData(type),
): AuthorizationPayload<T> {
  return {
    type,
    insurer: { ...src.insurer },
    provider: {
      cnes: blank(src.workspace.cnes),
      cnpj: blank(src.workspace.cnpj),
      legal_name: blank(src.workspace.legal_name),
    },
    professional: professionalSnapshot(src.professional),
    beneficiary: {
      patient_insurance_id: src.patientInsurance?.id ?? null,
      card_number: blank(src.patientInsurance?.card_number),
      newborn: false,
    },
    request,
  }
}

// "Recarregar dados": operadora, unidade e cadastro do profissional vêm do
// fresh; telefone/e-mail digitados, carteirinha digitada, RN e todo o pedido
// clínico ficam como estavam (mesmo padrão de mergeRefreshedPayload das guias).
export function mergeRefreshedAuthorizationPayload<T extends AuthorizationType>(
  current: AuthorizationPayload<T>,
  fresh: AuthorizationPayload<T>,
): AuthorizationPayload<T> {
  return {
    ...fresh,
    professional: {
      ...fresh.professional,
      phone: current.professional.phone,
      email: current.professional.email,
    },
    beneficiary: {
      patient_insurance_id: current.beneficiary.patient_insurance_id ?? fresh.beneficiary.patient_insurance_id,
      card_number: current.beneficiary.card_number ?? fresh.beneficiary.card_number,
      newborn: current.beneficiary.newborn,
    },
    request: current.request,
  }
}

export interface AuthorizationEdits<T extends AuthorizationType> {
  professional?: ProfessionalOption | null
  patientInsurance?: { id: string; card_number: string } | null
  card_number?: string | null
  newborn?: boolean
  professional_phone?: string | null
  professional_email?: string | null
  request?: RequestDataByType[T]
}

// Ordem: troca de profissional/carteira primeiro; depois os campos digitados.
// Trocar por OUTRO profissional limpa telefone/e-mail (eram do anterior);
// reenviar o mesmo id os preserva. Mande professional_phone/email no mesmo
// PATCH para preenchê-los de novo.
export function applyAuthorizationEdits<T extends AuthorizationType>(
  payload: AuthorizationPayload<T>,
  edits: AuthorizationEdits<T>,
): AuthorizationPayload<T> {
  const next: AuthorizationPayload<T> = {
    ...payload,
    professional: { ...payload.professional },
    beneficiary: { ...payload.beneficiary },
  }
  if (edits.professional !== undefined) {
    const snapshot = professionalSnapshot(edits.professional)
    const same = snapshot.id !== null && snapshot.id === payload.professional.id
    next.professional = same
      ? { ...snapshot, phone: payload.professional.phone, email: payload.professional.email }
      : snapshot
  }
  if (edits.patientInsurance !== undefined) {
    next.beneficiary.patient_insurance_id = edits.patientInsurance?.id ?? null
    next.beneficiary.card_number = blank(edits.patientInsurance?.card_number)
  }
  if (edits.card_number !== undefined) next.beneficiary.card_number = blank(edits.card_number)
  if (edits.newborn !== undefined) next.beneficiary.newborn = edits.newborn
  if (edits.professional_phone !== undefined) next.professional.phone = digits(edits.professional_phone)
  if (edits.professional_email !== undefined) next.professional.email = blank(edits.professional_email)
  if (edits.request !== undefined) next.request = edits.request
  return next
}
