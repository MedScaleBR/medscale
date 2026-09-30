import { el, type XmlNode } from '../xml'
import type { GuidePayload } from '@/lib/billing/types'

// Domínios do tissSimpleTypesV4_03_00.xsd usados pelas guias do MedScale.
// Valores fixos são o caso de consultório: sem acidente, ambulatorial, eletivo.
export const TABELA_TUSS_PROCEDIMENTOS = '22' // dm_tabela
export const CONSELHO_CRM = '06' // dm_conselhoProfissional
export const INDICADOR_NAO_ACIDENTE = '9' // dm_indicadorAcidente
export const REGIME_AMBULATORIAL = '01' // dm_regimeAtendimento
export const CARATER_ELETIVO = '1' // dm_caraterAtendimento
export const TIPO_ATENDIMENTO_CONSULTA = '04' // dm_tipoAtendimento

// dm_UF usa o código IBGE da UF, não a sigla.
export const UF_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41',
  SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}

// dm_tipoConsulta: 1 = primeira, 2 = seguimento.
export function tipoConsulta(payload: GuidePayload): string {
  return payload.service.is_return ? '2' : '1'
}

// numeroConselhoProfissional é texto de até 15 posições; CRMs costumam vir
// cadastrados como "123456/SP" ou "CRM-SP 123456" — fica só o número.
export function crmNumber(crm: string): string {
  const digits = crm.replace(/\D/g, '')
  return digits || crm
}

// ct_contratadoProfissionalDados
export function profissional(elementName: string, payload: GuidePayload): XmlNode {
  const p = payload.professional
  return el(elementName, [
    p.name.trim() !== '' && el('nomeProfissional', p.name.slice(0, 70)),
    el('conselhoProfissional', CONSELHO_CRM),
    el('numeroConselhoProfissional', crmNumber(p.crm ?? '')),
    el('UF', UF_IBGE[p.crm_uf ?? ''] ?? ''),
    el('CBOS', p.cbo_code ?? ''),
  ])
}

// ct_beneficiarioDados — o nome do beneficiário saiu do XML na 4.00.00.
export function beneficiario(payload: GuidePayload): XmlNode {
  return el('dadosBeneficiario', [
    el('numeroCarteira', payload.beneficiary.card_number ?? ''),
    el('atendimentoRN', 'N'),
  ])
}
