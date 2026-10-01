import { el, centsToDecimal, type XmlNode } from '../xml'
import type { GuidePayload } from '@/lib/billing/types'
import {
  beneficiario,
  profissional,
  tipoConsulta,
  CARATER_ELETIVO,
  INDICADOR_NAO_ACIDENTE,
  REGIME_AMBULATORIAL,
  TABELA_TUSS_PROCEDIMENTOS,
  TIPO_ATENDIMENTO_CONSULTA,
} from './common'

// GuidePayload → <guiaSP-SADT> (ctm_sp-sadtGuia, tissGuiasV4_03_00.xsd).
// No consultório o solicitante e o executante são o mesmo médico/clínica, e a
// guia tem um único procedimento executado. Sem campo de CID no 4.03.00.
export function buildSpSadtGuide(payload: GuidePayload, providerGuideNumber: string): XmlNode {
  const { insurer, provider, service } = payload
  const price = centsToDecimal(service.price_cents)

  return el('guiaSP-SADT', [
    el('cabecalhoGuia', [
      el('registroANS', insurer.ans_registry),
      el('numeroGuiaPrestador', providerGuideNumber),
    ]),
    // ct_autorizacaoSADT exige dataAutorizacao; sem data, o bloco inteiro fica
    // de fora (computeMissingFields já cobra a data quando há senha).
    service.authorization_date &&
      el('dadosAutorizacao', [
        el('dataAutorizacao', service.authorization_date),
        service.authorization_number && el('senha', service.authorization_number),
      ]),
    beneficiario(payload),
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', insurer.provider_code)]),
      el('nomeContratadoSolicitante', (provider.legal_name ?? '').slice(0, 70)),
      profissional('profissionalSolicitante', payload),
    ]),
    el('dadosSolicitacao', [
      el('dataSolicitacao', service.date),
      el('caraterAtendimento', CARATER_ELETIVO),
    ]),
    el('dadosExecutante', [
      el('contratadoExecutante', [el('codigoPrestadorNaOperadora', insurer.provider_code)]),
      el('CNES', provider.cnes ?? ''),
    ]),
    el('dadosAtendimento', [
      el('tipoAtendimento', TIPO_ATENDIMENTO_CONSULTA),
      el('indicacaoAcidente', INDICADOR_NAO_ACIDENTE),
      el('tipoConsulta', tipoConsulta(payload)),
      el('regimeAtendimento', REGIME_AMBULATORIAL),
    ]),
    el('procedimentosExecutados', [
      el('procedimentoExecutado', [
        el('sequencialItem', '1'),
        el('dataExecucao', service.date),
        el('procedimento', [
          el('codigoTabela', TABELA_TUSS_PROCEDIMENTOS),
          el('codigoProcedimento', service.tuss_code ?? ''),
          el('descricaoProcedimento', (service.description ?? '').slice(0, 150)),
        ]),
        el('quantidadeExecutada', '1'),
        el('reducaoAcrescimo', '1.00'),
        el('valorUnitario', price),
        el('valorTotal', price),
      ]),
    ]),
    el('valorTotal', [el('valorProcedimentos', price), el('valorTotalGeral', price)]),
  ])
}
