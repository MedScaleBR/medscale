import { describe, expect, it } from 'vitest'
import { friendlyErrorMessage, transcriptionErrorMessage } from '@/lib/friendly-errors'

describe('friendly error messages', () => {
  it.each([
    'duplicate key value violates unique constraint "patients_account_id_phone_key"',
    'Error: Claude returned an invalid SOAP record: SOAPValidationError: soap.S.queixa_principal é obrigatório',
    'Não foi possível criar o calendário: Error: invalid_grant',
    'Não foi possível salvar: permission denied for table patients',
    'Não foi possível salvar: relation patients does not exist',
    'TypeError: Failed to fetch',
    'Falha ao carregar o SDK do Facebook.',
    'patient_id é obrigatório',
    'Erro ao criar account.',
    { message: 'permission denied for table patients' },
    null,
    '__proto__',
  ])('hides internal details: %j', (error) => {
    expect(friendlyErrorMessage(error, 'Não foi possível salvar. Tente novamente.')).toBe('Não foi possível salvar. Tente novamente.')
  })
  it.each([
    'Informe um valor maior que zero.',
    'As senhas não coincidem.',
    'Essa carteirinha já está cadastrada para o paciente.',
    'O paciente cadastrado não corresponde ao nome e telefone da consulta. Corrija o vínculo do paciente antes de gravar.',
    'Você não tem permissão para realizar esta ação.',
  ])('preserves actionable validations: %s', (message) => {
    expect(friendlyErrorMessage(message)).toBe(message)
  })
  it('explains an expired session', () => {
    expect(friendlyErrorMessage('Unauthorized')).toBe('Sua sessão expirou. Entre novamente para continuar.')
  })
  it('translates invalid login credentials', () => {
    expect(friendlyErrorMessage(new Error('Invalid login credentials'))).toBe('E-mail ou senha incorretos. Confira os dados e tente novamente.')
  })
  it('explains the SOAP failure without exposing the model or medical field names', () => {
    expect(transcriptionErrorMessage('Error: Claude returned an invalid SOAP record: SOAPValidationError: soap.S.queixa_principal é obrigatório e deve ser uma string não vazia'))
      .toBe('Não foi possível gerar o prontuário desta consulta. Clique em “Tentar novamente”. Se o problema continuar, entre em contato com o suporte.')
  })
  it('handles old stored technical errors', () => {
    expect(transcriptionErrorMessage('Error: 429 insufficient_quota')).toBe('Não foi possível processar esta consulta agora. Clique em “Tentar novamente”. Se o problema continuar, entre em contato com o suporte.')
  })
})
