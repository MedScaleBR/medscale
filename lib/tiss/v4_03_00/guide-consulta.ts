import { el, centsToDecimal, type XmlNode } from '../xml'
import type { GuidePayload } from '@/lib/billing/types'
import {
  beneficiario,
  profissional,
  tipoConsulta,
  INDICADOR_NAO_ACIDENTE,
  REGIME_AMBULATORIAL,
  TABELA_TUSS_PROCEDIMENTOS,
} from './common'

// GuidePayload → <guiaConsulta> (ctm_consultaGuia, tissGuiasV4_03_00.xsd).
// A guia de consulta 4.03.00 não tem campo de CID nem de senha: a autorização
// da operadora vai em numeroGuiaOperadora.
export function buildConsultaGuide(payload: GuidePayload, providerGuideNumber: string): XmlNode {
  const { insurer, provider, service } = payload
  return el('guiaConsulta', [
    el('cabecalhoConsulta', [
      el('registroANS', insurer.ans_registry),
      el('numeroGuiaPrestador', providerGuideNumber),
    ]),
    service.authorization_number && el('numeroGuiaOperadora', service.authorization_number),
    beneficiario(payload),
    el('contratadoExecutante', [
      el('codigoPrestadorNaOperadora', insurer.provider_code),
      el('CNES', provider.cnes ?? ''),
    ]),
    profissional('profissionalExecutante', payload),
    el('indicacaoAcidente', INDICADOR_NAO_ACIDENTE),
    el('dadosAtendimento', [
      el('regimeAtendimento', REGIME_AMBULATORIAL),
      el('dataAtendimento', service.date),
      el('tipoConsulta', tipoConsulta(payload)),
      el('procedimento', [
        el('codigoTabela', TABELA_TUSS_PROCEDIMENTOS),
        el('codigoProcedimento', service.tuss_code ?? ''),
        el('valorProcedimento', centsToDecimal(service.price_cents)),
      ]),
    ]),
  ])
}
