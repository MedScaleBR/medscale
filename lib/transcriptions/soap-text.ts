import type { SOAPRecord } from './types'

// Texto puro do prontuário, para colar em outro sistema de uma vez só em vez
// de copiar campo a campo de cada aba. Campos vazios são omitidos; os alertas
// ficam de fora porque são avisos da IA para o médico, não parte do registro.

type Field = [label: string, value: string | null | string[]]

function formatField([label, value]: Field): string | null {
  if (Array.isArray(value)) {
    const items = value.map((item) => item.trim()).filter(Boolean)
    if (items.length === 0) return null
    return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`
  }
  const text = value?.trim()
  if (!text) return null
  return `${label}: ${text}`
}

function formatSection(title: string, fields: Field[]): string | null {
  const lines = fields.map(formatField).filter((line): line is string => line !== null)
  if (lines.length === 0) return null
  return `${title}\n${lines.join('\n')}`
}

export function formatSOAPAsText(record: SOAPRecord): string {
  const { S, O, A, P } = record.soap
  const resumo = record.resumo?.trim()

  const sections = [
    resumo ? `RESUMO\n${resumo}` : null,
    formatSection('S — SUBJETIVO', [
      ['Queixa principal', S.queixa_principal],
      ['História da doença atual', S.historia_atual],
      ['Antecedentes', S.antecedentes],
      ['Medicamentos em uso', S.medicamentos_em_uso],
    ]),
    formatSection('O — OBJETIVO', [
      ['Exame físico', O.exame_fisico],
      ['Exames solicitados', O.exames_solicitados],
      ['Resultados de exames', O.exames_resultados],
    ]),
    formatSection('A — AVALIAÇÃO', [
      ['Hipótese diagnóstica', A.hipotese_diagnostica],
      ['Diagnósticos secundários', A.diagnosticos_secundarios],
      ['CID-10', A.cid10],
    ]),
    formatSection('P — PLANO', [
      ['Prescrição', P.prescricao],
      ['Orientações', P.orientacoes],
      ['Retorno', P.retorno],
      ['Encaminhamentos', P.encaminhamentos],
    ]),
  ]

  return sections.filter((section): section is string => section !== null).join('\n\n')
}
