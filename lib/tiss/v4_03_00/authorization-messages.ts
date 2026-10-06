import { el } from '../xml'
import { buildOpmeAnnex } from './annex-opme'
import { cabecalho, mensagemTISS } from './envelope'
import type { BuiltBatch } from '@/lib/billing/types'
import type { AuthorizationXmlSource } from '@/lib/billing/authorizations/types'

// Anexo de OPME avulso: prestadorParaOperadora/loteAnexos (ct_anexoLote) com
// um único anexoSolicitacaoOPME. numeroLote = número do próprio anexo (D5).
export function buildOpmeAnnexMessage(input: {
  annex: AuthorizationXmlSource<'opme_request'>
  referencedGuideNumber: string
  now: Date
}): BuiltBatch {
  const { annex } = input
  if (annex.items.length === 0) throw new Error('anexo OPME sem materiais')
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
