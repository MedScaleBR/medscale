// O agente responde em markdown (**assim**) e o WhatsApp marca negrito com um
// asterisco só (*assim*). Nenhum dos dois é renderizado por padrão na caixa de
// entrada: sem isto o atendente lê "**Unidade Principal**" com os asteriscos
// crus, que foi como a mensagem saiu na tela.

export interface RichSegment {
  text: string
  bold: boolean
}

// Negrito precisa começar e terminar em caractere visível e não cruzar linha —
// é o que separa marcação de "2 * 3" e de bullet no começo da linha.
const BOLD = /\*\*(\S(?:[^*\n]*\S)?)\*\*|__(\S(?:[^_\n]*\S)?)__|\*(\S(?:[^*\n]*\S)?)\*/g

// Só as formas de markdown: o `*assim*` que o WhatsApp já entende fica de fora.
const MARKDOWN_BOLD = /\*\*(\S(?:[^*\n]*\S)?)\*\*|__(\S(?:[^_\n]*\S)?)__/g

export function parseRichText(content: string): RichSegment[] {
  const segments: RichSegment[] = []
  let cursor = 0

  for (const match of content.matchAll(BOLD)) {
    const start = match.index
    if (start > cursor) segments.push({ text: content.slice(cursor, start), bold: false })
    segments.push({ text: match[1] ?? match[2] ?? match[3], bold: true })
    cursor = start + match[0].length
  }

  if (cursor < content.length) segments.push({ text: content.slice(cursor), bold: false })
  return segments
}

/**
 * Traduz o negrito de markdown para o do WhatsApp (`*assim*`).
 *
 * O prompt manda o agente não usar markdown e ele usa mesmo assim — o paciente
 * recebia "**Unidade Principal**" com os asteriscos à mostra, porque o WhatsApp
 * não formata `**`. Converter na saída não depende do modelo obedecer.
 */
export function toWhatsAppMarkup(text: string): string {
  return text.replace(MARKDOWN_BOLD, (_, double, underscore) => `*${double ?? underscore}*`)
}
