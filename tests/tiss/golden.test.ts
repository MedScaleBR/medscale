import { describe, it, expect } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildBatch } from '@/lib/tiss/v4_03_00/batch'
import type { GuideType } from '@/lib/billing/types'
import { fakeGuides, FAKE_INSURER, FIXED_NOW } from './fixtures'

// Trava a saída de buildBatch byte a byte antes da extração do cabecalho
// para as autorizações TISS. Regerar só de propósito: UPDATE_GOLDEN=1.
const CASES: Array<{ type: GuideType; count: number; file: string }> = [
  { type: 'consulta', count: 3, file: 'tests/tiss/golden/lote-consulta-3.xml' },
  { type: 'sp_sadt', count: 2, file: 'tests/tiss/golden/lote-sp-sadt-2.xml' },
]

function build(type: GuideType, count: number) {
  const guides = fakeGuides(count, type)
  if (type === 'sp_sadt') {
    // Cobre dadosAutorizacao e escape de & e < no mesmo arquivo.
    guides[0].payload.service.authorization_number = 'SENHA123'
    guides[0].payload.service.authorization_date = '2026-09-20'
    guides[1].payload.provider.legal_name = 'Silva & Souza <Clínica> Ltda'
  }
  return buildBatch({ batchNumber: 7, guideType: type, insurer: FAKE_INSURER, guides, now: FIXED_NOW })
}

describe('buildBatch — golden byte a byte', () => {
  it.each(CASES)('lote $type com $count guias é idêntico ao arquivo de referência', async ({ type, count, file }) => {
    const { xml } = build(type, count)
    if (process.env.UPDATE_GOLDEN === '1') {
      await mkdir('tests/tiss/golden', { recursive: true })
      await writeFile(file, xml)
    }
    const golden = await readFile(file)
    expect(xml.equals(golden)).toBe(true)
  })
})
