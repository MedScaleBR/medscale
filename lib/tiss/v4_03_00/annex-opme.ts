import { centsToDecimal, el, type XmlNode } from '../xml'
import { beneficiarioSolicitacao, clip, optId, optText, procedimentoDados } from './authorization-common'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

export interface OpmeAnnexInput {
  annex: AuthorizationXmlSource<'opme_request'>
  // cabecalhoAnexo/numeroGuiaReferenciada: provider_guide_number da SP/SADT
  // ou Internação de origem (D5). O XSD não diz se é o número do prestador
  // ou da operadora [AMBÍGUO]; usamos o do prestador.
  referencedGuideNumber: string
}

// ctm_anexoSolicitacaoOPME. elementName = 'solicitacaoOPME' quando vai
// embutido em anexoClinico; 'anexoSolicitacaoOPME' no loteAnexos avulso.
// numeroGuiaOperadora/senha/dataAutorizacao do cabecalhoAnexo ficam de fora:
// na solicitação ainda não existem (vêm na resposta).
export function buildOpmeAnnex(elementName: 'solicitacaoOPME' | 'anexoSolicitacaoOPME', input: OpmeAnnexInput): XmlNode {
  const { annex, referencedGuideNumber } = input
  const { payload, items } = annex
  return el(elementName, [
    el('cabecalhoAnexo', [
      el('registroANS', payload.insurer.ans_registry),
      el('numeroGuiaAnexo', annex.providerGuideNumber),
      el('numeroGuiaReferenciada', referencedGuideNumber),
      el('dataSolicitacao', annex.requestedAt),
    ]),
    beneficiarioSolicitacao(payload),
    // ctm_anexoSolicitante — tipo diferente do profissional das guias.
    el('profissionalSolicitante', [
      el('nomeProfissional', clip(payload.professional.name, 70)),
      el('telefoneProfissional', payload.professional.phone ?? ''),
      optId('emailProfissional', payload.professional.email),
    ]),
    el('justificativaTecnica', clip(payload.request.technical_justification, 1000)),
    optText('especificacaoMaterial', payload.request.material_specification, 500),
    el(
      'opmeSolicitadas',
      items.map((item) =>
        el('opmeSolicitada', [
          procedimentoDados('identificacaoOPME', item),
          el('opcaoFabricante', item.manufacturer_option ?? ''),
          el('quantidadeSolicitada', String(item.quantity_requested)),
          item.requested_value_cents !== null && el('valorSolicitado', centsToDecimal(item.requested_value_cents)),
          optId('registroANVISA', item.anvisa_registration),
          optId('codigoRefFabricante', item.manufacturer_reference),
          optId('autorizacaoFuncionamento', item.operating_authorization),
        ]),
      ),
    ),
    // "Observacao" com O maiúsculo — grafia do XSD, só neste tipo.
    optText('Observacao', payload.request.observation, 500),
  ])
}
