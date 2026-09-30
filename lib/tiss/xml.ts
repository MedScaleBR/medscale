import { create } from 'xmlbuilder2'

// Árvore mínima de elementos TISS, independente de versão. O gerador de cada
// versão monta a árvore; daqui saem o XML serializado e a lista de valores na
// ordem do documento (base do hash do epílogo) — os dois a partir da mesma
// estrutura, então o hash sempre bate com o conteúdo do arquivo.

export const TISS_NAMESPACE = 'http://www.ans.gov.br/padroes/tiss/schemas'

export type XmlNode =
  | { name: string; value: string }
  | { name: string; children: XmlNode[] }

// Filhos opcionais entram como null/undefined/false e são descartados — deixa
// os geradores escreverem a sequência do XSD na ordem, sem ifs espalhados.
type Child = XmlNode | null | undefined | false | ''

export function el(name: string, content: string | Child[]): XmlNode {
  if (typeof content === 'string') return { name, value: toLatin1Text(content) }
  return { name, children: content.filter((c): c is XmlNode => Boolean(c)) }
}

// O Padrão TISS usa ISO-8859-1. Caracteres fora do Latin-1 viram a letra base
// quando existe (ex.: "ő" → "o") e são descartados quando não; caracteres de
// controle (CR/LF/tab) somem — um valor com quebra de linha mudaria o hash
// dependendo de como o XML fosse normalizado do outro lado.
export function toLatin1Text(input: string): string {
  let out = ''
  for (const ch of input.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue
    if (code <= 0xff) {
      out += ch
      continue
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    for (const b of base) {
      const c = b.codePointAt(0) ?? 0
      if (c >= 0x20 && c <= 0xff && !(c >= 0x7f && c <= 0x9f)) out += b
    }
  }
  return out.trim()
}

// Valores de texto na ordem do documento — o que o hash TISS concatena.
export function textValues(node: XmlNode): string[] {
  if ('value' in node) return [node.value]
  return node.children.flatMap(textValues)
}

// XML sem indentação: nenhum nó de texto "de espaço" entre tags, então não há
// ambiguidade sobre o que entra no hash. Prefixo "ans:" como nos exemplos da ANS.
export function serialize(root: XmlNode): Buffer {
  const doc = create({ version: '1.0', encoding: 'ISO-8859-1' })
  const append = (parent: ReturnType<typeof doc.ele>, node: XmlNode) => {
    const e = parent.ele(TISS_NAMESPACE, `ans:${node.name}`)
    if ('value' in node) e.txt(node.value)
    else for (const child of node.children) append(e, child)
  }
  const rootEl = doc.ele(TISS_NAMESPACE, `ans:${root.name}`)
  if ('value' in root) rootEl.txt(root.value)
  else for (const child of root.children) append(rootEl, child)
  return Buffer.from(doc.end({ prettyPrint: false }), 'latin1')
}

// Centavos → "150.00" (st_decimal10-2) sem passar por float.
export function centsToDecimal(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  const sign = cents < 0 ? '-' : ''
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
