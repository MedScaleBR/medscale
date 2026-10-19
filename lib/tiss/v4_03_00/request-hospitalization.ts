import { el, type XmlNode } from '../xml'
import { buildOpmeAnnex, type OpmeAnnexInput } from './annex-opme'
import {
  beneficiarioSolicitacao, clip, etapaEValidacao, optText, procedimentosSolicitados, profissionalContratado,
} from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// ctm_internacaoSolicitacaoGuia (elemento solicitacaoInternacao). Sem
// cabecalhoSolicitacao: registroANS e numeroGuiaPrestador soltos no topo.
// Ordem: registroANS, numeroGuiaPrestador, ausenciaCodValidacao?,
// codValidacao?, tipoEtapaAutorizacao, dadosBeneficiario,
// identificacaoSolicitante, dadosHospitalSolicitado, dadosInternacao,
// hipotesesDiagnosticas, procedimentosSolicitados+, dataSolicitacao,
// observacao? (st_texto1000), anexoClinico?.
// Obrigatórios ausentes saem vazios de propósito: o XSD reprova e a rota
// devolve 422 apontando o elemento (missing_fields já avisa antes).
export function buildHospitalizationRequest(
  source: AuthorizationXmlSource<'hospitalization_request'>,
  opme: OpmeAnnexInput | null,
  hasActiveOpme = false,
): XmlNode {
  const { payload } = source
  const r = payload.request
  return el('solicitacaoInternacao', [
    el('registroANS', payload.insurer.ans_registry),
    el('numeroGuiaPrestador', source.providerGuideNumber),
    ...etapaEValidacao(r),
    beneficiarioSolicitacao(payload),
    // Sem nome do contratado (diferente da SP/SADT).
    el('identificacaoSolicitante', [
      el('dadosDoContratado', [el('codigoPrestadorNaOperadora', payload.insurer.provider_code)]),
      profissionalContratado('dadosProfissionalContratado', payload.professional),
    ]),
    el('dadosHospitalSolicitado', [
      el('codigoIndicadonaOperadora', r.hospital.operator_code ?? ''),
      el('nomeContratadoIndicado', clip(r.hospital.name, 70)),
      el('dataSugeridaInternacao', r.hospital.suggested_date ?? ''),
    ]),
    el('dadosInternacao', [
      el('caraterAtendimento', r.character),
      el('tipoInternacao', r.hospitalization_type),
      el('regimeInternacao', r.regime),
      el('qtDiariasSolicitadas', r.daily_count === null ? '' : String(r.daily_count)),
      // S se a previsão foi marcada ou se existe ao menos um OPME não
      // cancelado — embutido nesta mensagem ou enviado à parte.
      el('indicadorOPME', r.opme_expected || opme || hasActiveOpme ? 'S' : 'N'),
      el('indicadorQuimio', r.chemo_expected ? 'S' : 'N'),
      el('indicacaoClinica', clip(r.clinical_indication, 500)),
    ]),
    el('hipotesesDiagnosticas', [
      // st_texto4, 0..4 — normalizados (sem ponto) e limitados a 4 na
      // validação da API. Sem slice: um 5º CID não some calado, o XSD reprova.
      ...r.cid10.map((cid) => el('diagnosticoCID', cid)),
      el('indicadorAcidente', r.accident),
    ]),
    ...procedimentosSolicitados(source.items),
    el('dataSolicitacao', source.requestedAt),
    optText('observacao', r.observation, 1000),
    opme && el('anexoClinico', [buildOpmeAnnex('solicitacaoOPME', opme)]),
  ])
}
