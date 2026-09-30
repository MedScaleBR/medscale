import type { TissGuideType, TissGuideStatus, TissBatchStatus } from '@/types/database'

export type GuideType = TissGuideType
export type GuideStatus = TissGuideStatus
export type BatchStatus = TissBatchStatus

// Snapshot congelado no momento da geração da guia (tiss_guides.payload).
// Os campos aqui são o que o MedScale sabe; o mapeamento para os elementos do
// XSD fica isolado em lib/tiss/v4_03_00/*. Nunca logar/enviar a terceiros —
// tem carteirinha, nome do paciente e CID.
export type GuidePayload = {
  insurer: { ans_registry: string; provider_code: string; tiss_version: string }
  provider: { cnes: string | null; cnpj: string | null; legal_name: string | null }
  professional: {
    name: string
    crm: string | null
    crm_uf: string | null
    cbo_code: string | null
  }
  beneficiary: { card_number: string | null; name: string; valid_until: string | null }
  service: {
    date: string // YYYY-MM-DD no fuso de SP
    guide_type: GuideType
    // appointments.type === 'retorno' → tipoConsulta "2 - Seguimento" na guia
    is_return: boolean
    tuss_code: string | null
    description: string | null
    price_cents: number
    authorization_number: string | null
    authorization_date: string | null
    cid10: string | null // de transcriptions.medical_record_final.soap.A.cid10
  }
}

// Chaves de missing_fields — estáveis, a UI traduz para rótulos.
export type MissingField =
  | 'beneficiary.card_number'
  | 'provider.cnes'
  | 'provider.legal_name'
  | 'professional.crm'
  | 'professional.crm_uf'
  | 'professional.cbo_code'
  | 'service.tuss_code'
  | 'service.description'
  | 'service.authorization_date'

// Guia pronta para entrar num lote — o gerador de cada versão só recebe isto.
export interface BatchGuide {
  id: string
  provider_guide_number: string
  guide_type: GuideType
  payload: GuidePayload
}

export interface BatchInput {
  batchNumber: number
  guideType: GuideType
  insurer: { ans_registry: string; provider_code: string }
  guides: BatchGuide[]
  // Momento da geração — vira dataRegistroTransacao/horaRegistroTransacao.
  now: Date
}

export interface BuiltBatch {
  xml: Buffer // ISO-8859-1
  hash: string
}

export interface ValidationResult {
  valid: boolean
  // Mensagens do validador sem valores — seguras para tiss_batches.error_message.
  errors: string[]
}

export interface TissVersionModule {
  version: string
  buildBatch(input: BatchInput): BuiltBatch
  validate(xml: Uint8Array): Promise<ValidationResult>
}
