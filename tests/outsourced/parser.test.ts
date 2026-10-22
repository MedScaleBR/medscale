import { describe, expect, it } from 'vitest'
import {
  classifyUnparsedReply,
  parseClinicConfirmation,
  pickPendingMatch,
} from '../../lib/outsourced/parser'

const COM_NOME = 'CONSULTA AGENDADA - IAD PITUBA\n\nMarilene Ribeiro\n\nMédico: Dr Gutemberg Brito\nHorário: 09:00\nData: 09/10/2026\n📍Nosso endereço: ...'
const SEM_NOME = 'CONSULTA AGENDADA- IAD PITUBA\n\nMédico: Dr Gutemberg Brito\nHorário: 08:00\nData: 16/10/2026\n📍Nosso endereço: ...'

describe('parseClinicConfirmation', () => {
  it('formato com nome', () =>
    expect(parseClinicConfirmation(COM_NOME)).toEqual({
      scheduledAt: new Date('2026-10-09T12:00:00.000Z'),
      patientName: 'Marilene Ribeiro',
      doctorName: 'Dr Gutemberg Brito',
    }))
  it('formato sem nome, hífen colado', () =>
    expect(parseClinicConfirmation(SEM_NOME)).toEqual({
      scheduledAt: new Date('2026-10-16T11:00:00.000Z'),
      patientName: null,
      doctorName: 'Dr Gutemberg Brito',
    }))
  it('caixa e emojis ao redor', () =>
    expect(
      parseClinicConfirmation('✅ consulta agendada ✅\nhorário: 08:00\ndata: 16/10/2026')?.scheduledAt.toISOString()
    ).toBe('2026-10-16T11:00:00.000Z'))
  it('CRLF', () => expect(parseClinicConfirmation(SEM_NOME.replace(/\n/g, '\r\n'))).not.toBeNull())
  it.each([
    'não tenho esse horário',
    'Bom dia! Qual o convênio?',
    '',
    'CONSULTA AGENDADA - IAD PITUBA\nHorário: 08:00', // sem data
    'CONSULTA AGENDADA - IAD PITUBA\nData: 16/10/2026', // sem hora
    'CONSULTA AGENDADA\nHorário: 08:00\nData: 31/02/2026', // data inexistente
    'CONSULTA AGENDADA\nHorário: 25:00\nData: 16/10/2026', // hora inválida
    'Ainda não deixei a consulta agendada\nHorário: 08:00\nData: 16/10/2026', // cabeçalho não está no início da linha
  ])('%s → null', (t) => expect(parseClinicConfirmation(t)).toBeNull())
})

describe('classifyUnparsedReply', () => {
  it('classifica negação', () => {
    expect(classifyUnparsedReply('Não tenho esse horário')).toBe('negacao')
    expect(classifyUnparsedReply('sem vaga dia 16')).toBe('negacao')
    expect(classifyUnparsedReply('Médico indisponível')).toBe('negacao')
    expect(classifyUnparsedReply('Pode ser às 9h?')).toBe('ambiguo')
    expect(classifyUnparsedReply('Nãoé possível')).toBe('ambiguo') // sem fronteira de palavra
  })
})

describe('pickPendingMatch', () => {
  it('só confirma com exatamente um candidato correlacionado', () => {
    const a = { id: 'a', patient_name: 'Marilene Ribeiro' }
    const b = { id: 'b', patient_name: 'José Souza' }
    expect(pickPendingMatch([a], null)).toBe('a')
    expect(pickPendingMatch([], 'X')).toBeNull()
    expect(pickPendingMatch([a, b], null)).toBeNull()
    expect(pickPendingMatch([a, b], 'MARILENE  RIBEIRO')).toBe('a')
    expect(pickPendingMatch([a, b], 'jose souza')).toBe('b')
    expect(pickPendingMatch([a, { id: 'c', patient_name: 'marilene ribeiro' }], 'Marilene Ribeiro')).toBeNull()
  })
})
