import { describe, it, expect } from 'vitest'
import {
  buildSolicitacaoParams, sanitizeTemplateParam, formatPhoneForTemplate,
  renderSolicitacaoText, buildConsultaConfirmadaParams,
} from '@/lib/outsourced/templates'

const at = new Date('2026-10-16T11:00:00.000Z') // 08:00 em SP

describe('templates da clínica parceira', () => {
  it('parâmetros da solicitação na ordem do template', () => {
    expect(buildSolicitacaoParams({ scheduledAt: at, patientName: 'Maria Aparecida Souza', insuranceLabel: 'Unimed', birthDate: '1980-05-03', patientPhone: '5571999990000' }))
      .toEqual(['16/10', '08:00', 'Maria Aparecida Souza', 'Unimed', '03/05/1980', '71 99999-0000'])
  })
  it('sanitiza quebra de linha, tab e 4+ espaços; vazio vira "-"', () => {
    expect(sanitizeTemplateParam('Maria\nSouza\t  Lima    Neta')).toBe('Maria Souza Lima Neta')
    expect(sanitizeTemplateParam('   ')).toBe('-')
  })
  it('telefone sem o nono dígito', () => expect(formatPhoneForTemplate('557199990000')).toBe('71 9999-0000'))
  it('texto renderizado igual ao template cadastrado', () => {
    expect(renderSolicitacaoText(['16/10', '08:00', 'Maria', 'Particular', '03/05/1980', '71 99999-0000'])).toBe(
      'Olá, tudo bem?\n\nAgenda por favor o dia 16/10 às 08:00:\n\nNome: Maria\nConvênio: Particular\nData de Nascimento: 03/05/1980\nContato: 71 99999-0000\n\nAguardamos a confirmação. Obrigado!')
  })
  it('consulta_confirmada usa o primeiro nome', () =>
    expect(buildConsultaConfirmadaParams({ patientName: 'Marilene Ribeiro', scheduledAt: at, unitName: 'IAD Pituba' })).toEqual(['Marilene', '16/10', '08:00', 'IAD Pituba']))
})
