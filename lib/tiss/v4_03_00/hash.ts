import { createHash } from 'crypto'
import { textValues, type XmlNode } from '../xml'

// Hash do epílogo — Padrão TISS, Componente Organizacional (set/2026), item 148:
// "o cálculo do hash deve considerar apenas concatenação do conteúdo das tags
// desprezando tags XML propriamente ditas [...] de forma literal [...] O
// encoding a ser utilizado será sempre o ISO-8859-1. O epílogo das mensagens
// [...] contém o hash apenas dos valores contidos nas transações".
//
// Então: MD5 (hex minúsculo) dos bytes ISO-8859-1 da concatenação, em ordem de
// documento, dos valores de todos os elementos da mensagem ANTES do epílogo
// (cabecalho + prestadorParaOperadora). O próprio epílogo fica de fora — é onde
// o hash vai.
export function epilogueHash(sections: XmlNode[]): string {
  const content = sections.flatMap(textValues).join('')
  return createHash('md5').update(Buffer.from(content, 'latin1')).digest('hex')
}
