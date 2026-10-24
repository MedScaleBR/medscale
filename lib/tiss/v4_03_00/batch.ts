import { el } from '../xml'
import { validateAgainstSchemas } from '../validate'
import { VERSION, cabecalho, mensagemTISS } from './envelope'
import { buildConsultaGuide } from './guide-consulta'
import { buildSpSadtGuide } from './guide-sp-sadt'
import type { BatchInput, BuiltBatch, TissVersionModule } from '@/lib/billing/types'

export { VERSION }

// guiasTISS é um <choice> com maxOccurs="100": um lote tem um único tipo de
// guia e no máximo 100 delas.
export const MAX_GUIDES_PER_BATCH = 100

const SCHEMAS = {
  version: VERSION,
  main: 'tissV4_03_00.xsd',
  includes: [
    'xmldsig-core-schema.xsd',
    'tissAssinaturaDigital_v1.01.xsd',
    'tissSimpleTypesV4_03_00.xsd',
    'tissComplexTypesV4_03_00.xsd',
    'tissGuiasV4_03_00.xsd',
  ],
}

// Mensagem ENVIO_LOTE_GUIAS completa (mensagemTISS, tissV4_03_00.xsd).
export function buildBatch(input: BatchInput): BuiltBatch {
  if (input.guides.length === 0) throw new Error('lote sem guias')
  if (input.guides.length > MAX_GUIDES_PER_BATCH) throw new Error('lote acima de 100 guias')
  if (input.guides.some((g) => g.guide_type !== input.guideType)) throw new Error('lote com tipos de guia misturados')

  const buildGuide = input.guideType === 'consulta' ? buildConsultaGuide : buildSpSadtGuide
  const batchNumber = String(input.batchNumber)

  const head = cabecalho({
    tipoTransacao: 'ENVIO_LOTE_GUIAS',
    sequencialTransacao: batchNumber,
    now: input.now,
    insurer: input.insurer,
  })

  const body = el('prestadorParaOperadora', [
    el('loteGuias', [
      el('numeroLote', batchNumber),
      el(
        'guiasTISS',
        input.guides.map((g) => buildGuide(g.payload, g.provider_guide_number)),
      ),
    ]),
  ])

  return mensagemTISS(head, body)
}

export function validate(xml: Uint8Array) {
  return validateAgainstSchemas(SCHEMAS, xml)
}

export const v4_03_00: TissVersionModule = { version: VERSION, buildBatch, validate }
