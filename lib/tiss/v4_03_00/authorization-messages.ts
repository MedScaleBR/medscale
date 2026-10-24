import { el } from '../xml'
import { buildOpmeAnnex } from './annex-opme'
import { cabecalho, mensagemTISS } from './envelope'
import { buildHospitalizationRequest } from './request-hospitalization'
import { buildSpSadtRequest } from './request-sp-sadt'
import type { BuiltBatch } from '@/lib/billing/types'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// Falha esperada dos montadores (mensagem sem itens). Qualquer outro erro é bug
// e deve propagar.
export class AuthorizationBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationBuildError'
  }
}

// Solicitação de SP/SADT ou de Internação: prestadorParaOperadora/
// solicitacaoProcedimento — uma solicitação por mensagem (o choice de
// ctm_solicitacaoLote não repete). Com exatamente um OPME vinculado, ele vai
// embutido em anexoClinico/solicitacaoOPME referenciando esta guia (D5).
export function buildAuthorizationRequestMessage(input: {
  request: AuthorizationXmlSource<'sp_sadt_request'> | AuthorizationXmlSource<'hospitalization_request'>
  embeddedOpme: AuthorizationXmlSource<'opme_request'> | null
  // OPME não cancelado que não cabe nesta mensagem (dois ou mais anexos).
  hasActiveOpme?: boolean
  now: Date
}): BuiltBatch {
  const { request } = input
  if (request.items.length === 0) throw new AuthorizationBuildError('solicitação sem procedimentos')
  if (input.embeddedOpme && input.embeddedOpme.items.length === 0) throw new AuthorizationBuildError('anexo OPME sem materiais')
  const opme = input.embeddedOpme
    ? { annex: input.embeddedOpme, referencedGuideNumber: request.providerGuideNumber }
    : null
  const body = request.type === 'sp_sadt_request'
    ? buildSpSadtRequest(request, opme)
    : buildHospitalizationRequest(request, opme, input.hasActiveOpme ?? false)
  return mensagemTISS(
    cabecalho({
      tipoTransacao: 'SOLICITACAO_PROCEDIMENTOS',
      sequencialTransacao: request.providerGuideNumber,
      now: input.now,
      insurer: request.payload.insurer,
    }),
    el('prestadorParaOperadora', [el('solicitacaoProcedimento', [body])]),
  )
}

// Anexo de OPME avulso: prestadorParaOperadora/loteAnexos (ct_anexoLote) com
// um único anexoSolicitacaoOPME. numeroLote = número do próprio anexo (D5).
export function buildOpmeAnnexMessage(input: {
  annex: AuthorizationXmlSource<'opme_request'>
  referencedGuideNumber: string
  now: Date
}): BuiltBatch {
  const { annex } = input
  if (annex.items.length === 0) throw new AuthorizationBuildError('anexo OPME sem materiais')
  return mensagemTISS(
    cabecalho({
      tipoTransacao: 'ENVIO_ANEXO',
      sequencialTransacao: annex.providerGuideNumber,
      now: input.now,
      insurer: annex.payload.insurer,
    }),
    el('prestadorParaOperadora', [
      el('loteAnexos', [
        el('numeroLote', annex.providerGuideNumber),
        el('AnexosGuiasTISS', [
          buildOpmeAnnex('anexoSolicitacaoOPME', { annex, referencedGuideNumber: input.referencedGuideNumber }),
        ]),
      ]),
    ]),
  )
}
