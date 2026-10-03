import { describe, expect, it } from 'vitest'
import { formatSOAPAsText } from '@/lib/transcriptions/soap-text'
import type { SOAPRecord } from '@/lib/transcriptions/types'

const full: SOAPRecord = {
  soap: {
    S: {
      queixa_principal: 'Dor de cabeça há 3 dias',
      historia_atual: 'Cefaleia frontal, pior à tarde.',
      antecedentes: 'HAS',
      medicamentos_em_uso: ['Losartana 50mg', 'AAS 100mg'],
    },
    O: {
      exame_fisico: 'PA 140x90',
      exames_solicitados: ['Hemograma'],
      exames_resultados: null,
    },
    A: {
      hipotese_diagnostica: 'Cefaleia tensional',
      diagnosticos_secundarios: [],
      cid10: 'G44.2',
    },
    P: {
      prescricao: ['Dipirona 1g 6/6h se dor'],
      orientacoes: ['Hidratação'],
      retorno: '30 dias',
      encaminhamentos: [],
    },
  },
  resumo: 'Paciente com cefaleia tensional.',
  alertas: ['Pressão elevada'],
}

describe('formatSOAPAsText', () => {
  it('monta o prontuário inteiro em um bloco, seção por seção', () => {
    expect(formatSOAPAsText(full)).toBe(
      [
        'RESUMO',
        'Paciente com cefaleia tensional.',
        '',
        'S — SUBJETIVO',
        'Queixa principal: Dor de cabeça há 3 dias',
        'História da doença atual: Cefaleia frontal, pior à tarde.',
        'Antecedentes: HAS',
        'Medicamentos em uso:',
        '- Losartana 50mg',
        '- AAS 100mg',
        '',
        'O — OBJETIVO',
        'Exame físico: PA 140x90',
        'Exames solicitados:',
        '- Hemograma',
        '',
        'A — AVALIAÇÃO',
        'Hipótese diagnóstica: Cefaleia tensional',
        'CID-10: G44.2',
        '',
        'P — PLANO',
        'Prescrição:',
        '- Dipirona 1g 6/6h se dor',
        'Orientações:',
        '- Hidratação',
        'Retorno: 30 dias',
      ].join('\n'),
    )
  })

  it('não inclui os alertas da IA', () => {
    expect(formatSOAPAsText(full)).not.toContain('Pressão elevada')
  })

  it('omite seções sem nenhum campo preenchido', () => {
    const text = formatSOAPAsText({
      ...full,
      soap: {
        ...full.soap,
        O: { exame_fisico: '  ', exames_solicitados: [], exames_resultados: null },
      },
    })
    expect(text).not.toContain('O — OBJETIVO')
    expect(text).toContain('S — SUBJETIVO\n')
    expect(text).toContain('\n\nA — AVALIAÇÃO\n')
  })
})
