import { createHash } from 'crypto'

// Recalcula o hash do epílogo direto do arquivo: tira as tags entre
// <cabecalho> e <epilogo>, desfaz os escapes e aplica MD5 nos bytes ISO-8859-1.
export function hashFromFile(xml: Buffer): string {
  const text = xml.toString('latin1')
  const content = text
    .slice(text.indexOf('<ans:cabecalho>'), text.indexOf('<ans:epilogo>'))
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return createHash('md5').update(Buffer.from(content, 'latin1')).digest('hex')
}
