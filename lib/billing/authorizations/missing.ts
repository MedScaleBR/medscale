import { BRAZIL_UFS } from '../constants'
import type { AnyAuthorizationPayload, AuthorizationMissingField } from './types'

// Campos que o XSD exige e que o MedScale pode não ter. O XSD confere de novo
// na geração do XML (tamanho exato, enum de CBOS etc.). O SQL acrescenta
// 'items' por conta própria se não houver item.
export function computeAuthorizationMissing(payload: AnyAuthorizationPayload, itemCount: number): AuthorizationMissingField[] {
  const missing: AuthorizationMissingField[] = []
  const { beneficiary, professional, provider } = payload

  if (!beneficiary.card_number) missing.push('beneficiary.card_number')

  if (payload.type === 'opme_request') {
    // ctm_anexoSolicitante: nome [1], telefone [1] (st_texto11), e-mail [0..1].
    if (!professional.name.trim()) missing.push('professional.name')
    if (!professional.phone || !/^\d{10,11}$/.test(professional.phone)) missing.push('professional.phone')
    if (!payload.request.technical_justification) missing.push('request.technical_justification')
  } else {
    // nomeContratadoSolicitante só existe na SP/SADT.
    if (payload.type === 'sp_sadt_request' && !provider.legal_name) missing.push('provider.legal_name')
    // ct_contratadoProfissionalDados: conselho, número, UF e CBOS [1].
    if (!professional.crm || !/\d/.test(professional.crm)) missing.push('professional.crm')
    if (!professional.crm_uf || !(BRAZIL_UFS as readonly string[]).includes(professional.crm_uf)) {
      missing.push('professional.crm_uf')
    }
    if (!professional.cbo_code || !/^\d{6}$/.test(professional.cbo_code)) missing.push('professional.cbo_code')
    if (payload.type === 'hospitalization_request') {
      const r = payload.request
      if (!r.clinical_indication) missing.push('request.clinical_indication')
      if (!r.hospital.operator_code) missing.push('request.hospital.operator_code')
      if (!r.hospital.name) missing.push('request.hospital.name')
      if (!r.hospital.suggested_date) missing.push('request.hospital.suggested_date')
      if (r.daily_count == null) missing.push('request.daily_count')
    }
  }

  if (itemCount === 0) missing.push('items')
  return missing
}
