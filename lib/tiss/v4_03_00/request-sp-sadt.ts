import { el, type XmlNode } from '../xml'
import { buildOpmeAnnex, type OpmeAnnexInput } from './annex-opme'
import {
  beneficiarioSolicitacao, clip, etapaEValidacao, optId, optText, procedimentosSolicitados, profissionalContratado,
} from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// ctm_sp-sadtSolicitacaoGuia (elemento solicitacaoSP-SADT). Ordem do XSD:
// cabecalhoSolicitacao, numeroGuiaPrincipal?, ausenciaCodValidacao?,
// codValidacao?, tipoEtapaAutorizacao, dadosBeneficiario, dadosSolicitante,
// caraterAtendimento, dataSolicitacao, indicacaoClinica?, coberturaEspecial?,
// procedimentosSolicitados+, dadosExecutante?, anexoClinico?, observacao?.
// Sem valores, sem sequencialItem, sem campos de autorização (vêm na resposta).
export function buildSpSadtRequest(source: AuthorizationXmlSource<'sp_sadt_request'>, opme: OpmeAnnexInput | null): XmlNode {
  const { payload } = source
  const r = payload.request
  return el('solicitacaoSP-SADT', [
    el('cabecalhoSolicitacao', [
      el('registroANS', payload.insurer.ans_registry),
      el('numeroGuiaPrestador', source.providerGuideNumber),
    ]),
    optId('numeroGuiaPrincipal', r.main_guide_number),
    ...etapaEValidacao(r),
    beneficiarioSolicitacao(payload),
    // Idêntico ao dadosSolicitante da guia de cobrança.
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', payload.insurer.provider_code)]),
      el('nomeContratadoSolicitante', clip(payload.provider.legal_name, 70)),
      profissionalContratado('profissionalSolicitante', payload.professional),
    ]),
    el('caraterAtendimento', r.character),
    el('dataSolicitacao', source.requestedAt),
    optText('indicacaoClinica', r.clinical_indication, 500),
    r.special_coverage && el('coberturaEspecial', r.special_coverage),
    ...procedimentosSolicitados(source.items),
    r.executor &&
      el('dadosExecutante', [
        el('codigonaOperadora', r.executor.operator_code),
        el('CNES', r.executor.cnes),
      ]),
    opme && el('anexoClinico', [buildOpmeAnnex('solicitacaoOPME', opme)]),
    optText('observacao', r.observation, 500),
  ])
}
