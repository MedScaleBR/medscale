import { readFile } from 'fs/promises'
import path from 'path'
import { validateXML } from 'xmllint-wasm'
import type { ValidationResult } from '@/lib/billing/types'

// Validação contra os XSDs oficiais da ANS em lib/tiss/schemas/<versão>/.
// xmllint-wasm é o libxml2 compilado para WebAssembly — roda no runtime Node
// da Vercel sem binário nativo. Os .xsd entram no bundle da função pelo
// outputFileTracingIncludes do next.config.ts.

export interface SchemaSet {
  version: string // diretório em lib/tiss/schemas
  main: string // XSD raiz da mensagem
  includes: string[] // todo XSD que o raiz inclui/importa, direta ou indiretamente
}

const cache = new Map<string, Promise<{ main: SchemaFile; includes: SchemaFile[] }>>()

interface SchemaFile {
  fileName: string
  contents: Uint8Array
}

function loadSchemas(set: SchemaSet) {
  let loaded = cache.get(set.version)
  if (!loaded) {
    const dir = path.join(process.cwd(), 'lib', 'tiss', 'schemas', set.version)
    const read = async (fileName: string): Promise<SchemaFile> => ({
      fileName,
      contents: await readFile(path.join(dir, fileName)),
    })
    loaded = Promise.all([read(set.main), Promise.all(set.includes.map(read))]).then(([main, includes]) => ({
      main,
      includes,
    }))
    // Falha de leitura não fica em cache — a próxima chamada tenta de novo.
    loaded.catch(() => cache.delete(set.version))
    cache.set(set.version, loaded)
  }
  return loaded
}

// As mensagens do libxml2 citam o valor que falhou ("The value '1234' is not
// ..."), e o valor pode ser uma carteirinha. Mantém só o nome do elemento e o
// tipo de erro — é o que vai para tiss_batches.error_message.
export function sanitizeValidatorMessage(message: string): string {
  return message
    .replace(/'\{[^}]*\}([\w.-]+)'/g, '$1') // '{namespace}elemento' → elemento (sem aspas)
    .replace(/\[facet '(\w+)'\]/g, '[facet $1]')
    .replace(/'[^']*'/g, "'…'") // qualquer outro valor entre aspas pode ser dado do paciente
    .replace(/\{[^}]*\}/g, '{…}')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function validateAgainstSchemas(set: SchemaSet, xml: Uint8Array): Promise<ValidationResult> {
  const { main, includes } = await loadSchemas(set)
  const result = await validateXML({
    xml: [{ fileName: 'lote.xml', contents: xml }],
    schema: [main],
    preload: includes,
  })
  return {
    valid: result.valid,
    errors: result.errors.map((e) => sanitizeValidatorMessage(e.message)),
  }
}
