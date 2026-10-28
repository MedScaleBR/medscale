import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { el, serialize, type XmlNode } from '../xml'
import { epilogueHash } from './hash'
import type { BuiltBatch } from '@/lib/billing/types'

export const VERSION = '4.03.00'
const TZ = 'America/Sao_Paulo'

// dm_tipoTransacao usados pelo MedScale. O XSD não amarra o valor ao ramo de
// prestadorParaOperadora; SOLICITACAO_PROCEDIMENTOS (solicitacaoProcedimento)
// e ENVIO_ANEXO (loteAnexos) seguem a correspondência de nomes [INFERIDO].
export type TipoTransacao = 'ENVIO_LOTE_GUIAS' | 'SOLICITACAO_PROCEDIMENTOS' | 'ENVIO_ANEXO'

// cabecalhoTransacao — idêntico para lote de guias, solicitação e anexo.
export function cabecalho(input: {
  tipoTransacao: TipoTransacao
  sequencialTransacao: string
  now: Date
  insurer: { ans_registry: string; provider_code: string }
}): XmlNode {
  const now = new TZDate(input.now, TZ)
  return el('cabecalho', [
    el('identificacaoTransacao', [
      el('tipoTransacao', input.tipoTransacao),
      el('sequencialTransacao', input.sequencialTransacao),
      el('dataRegistroTransacao', format(now, 'yyyy-MM-dd')),
      el('horaRegistroTransacao', format(now, 'HH:mm:ss')),
    ]),
    el('origem', [el('identificacaoPrestador', [el('codigoPrestadorNaOperadora', input.insurer.provider_code)])]),
    el('destino', [el('registroANS', input.insurer.ans_registry)]),
    el('Padrao', VERSION),
  ])
}

// mensagemTISS = cabecalho + prestadorParaOperadora + epilogo(hash). O hash
// sai da mesma árvore serializada (hash.ts).
export function mensagemTISS(head: XmlNode, body: XmlNode): BuiltBatch {
  const hash = epilogueHash([head, body])
  const xml = serialize(el('mensagemTISS', [head, body, el('epilogo', [el('hash', hash)])]))
  return { xml, hash }
}
