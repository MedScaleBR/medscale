/**
 * Valida um arquivo XML de lote TISS contra os XSDs oficiais da ANS
 * (lib/tiss/schemas/<versão>) e confere o hash do epílogo.
 *
 *   npm run tiss:validate -- caminho/lote.xml
 *
 * Usa o mesmo validador do runtime (xmllint-wasm), então não depende de
 * xmllint instalado na máquina. Só a versão 4.03.00 tem gerador hoje.
 */
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { validate, VERSION } from '../lib/tiss/v4_03_00/batch'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('uso: npm run tiss:validate -- <arquivo.xml>')
    process.exit(2)
  }

  const xml = await readFile(file)
  const result = await validate(xml)
  console.log(`XSD TISS ${VERSION}: ${result.valid ? 'válido' : 'INVÁLIDO'}`)
  for (const e of result.errors) console.log(`  - ${e}`)

  // Hash: conteúdo das tags entre <cabecalho> e <epilogo>, sem as tags, em ISO-8859-1.
  const text = xml.toString('latin1')
  const body = text.slice(text.indexOf('<ans:cabecalho>'), text.indexOf('<ans:epilogo>'))
  const content = body
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  const expected = createHash('md5').update(Buffer.from(content, 'latin1')).digest('hex')
  const declared = /<ans:hash>([^<]*)<\/ans:hash>/.exec(text)?.[1] ?? ''
  const hashOk = declared.toLowerCase() === expected
  console.log(`Hash do epílogo: ${hashOk ? 'confere' : `NÃO confere (arquivo ${declared}, calculado ${expected})`}`)

  process.exit(result.valid && hashOk ? 0 : 1)
}

main()
