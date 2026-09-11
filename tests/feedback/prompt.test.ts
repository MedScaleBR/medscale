import { describe, it, expect } from 'vitest'
import {
  shouldShowFeedbackPrompt,
  validateFeedbackMessage,
  FEEDBACK_MESSAGE_MAX_LENGTH,
} from '@/lib/feedback/prompt'

const NOW = new Date('2026-09-10T12:00:00Z')

describe('shouldShowFeedbackPrompt', () => {
  it('deve mostrar quando o perfil nunca interagiu com o balão', () => {
    expect(shouldShowFeedbackPrompt({ dismissedAt: null, now: NOW })).toBe(true)
  })

  it('deve esconder quando a última interação foi há menos de 15 dias', () => {
    const dismissedAt = new Date('2026-09-01T12:00:00Z').toISOString()
    expect(shouldShowFeedbackPrompt({ dismissedAt, now: NOW })).toBe(false)
  })

  it('deve esconder quando faltam minutos para completar 15 dias', () => {
    const dismissedAt = new Date('2026-08-26T12:30:00Z').toISOString()
    expect(shouldShowFeedbackPrompt({ dismissedAt, now: NOW })).toBe(false)
  })

  it('deve mostrar quando a última interação completou exatamente 15 dias', () => {
    const dismissedAt = new Date('2026-08-26T12:00:00Z').toISOString()
    expect(shouldShowFeedbackPrompt({ dismissedAt, now: NOW })).toBe(true)
  })

  it('deve mostrar quando a última interação foi há mais de 15 dias', () => {
    const dismissedAt = new Date('2026-07-01T12:00:00Z').toISOString()
    expect(shouldShowFeedbackPrompt({ dismissedAt, now: NOW })).toBe(true)
  })

  it('deve mostrar quando a data gravada é inválida', () => {
    expect(shouldShowFeedbackPrompt({ dismissedAt: 'não é data', now: NOW })).toBe(true)
  })
})

describe('validateFeedbackMessage', () => {
  it('deve aceitar mensagem normal removendo espaços das pontas', () => {
    const result = validateFeedbackMessage('  a agenda podia ter visão anual  ')
    expect(result).toEqual({ ok: true, message: 'a agenda podia ter visão anual' })
  })

  it('deve recusar mensagem vazia', () => {
    expect(validateFeedbackMessage('')).toEqual({ ok: false, error: 'Mensagem é obrigatória' })
  })

  it('deve recusar mensagem só com espaços', () => {
    expect(validateFeedbackMessage('   \n  ')).toEqual({ ok: false, error: 'Mensagem é obrigatória' })
  })

  it('deve recusar quando o corpo não é string', () => {
    expect(validateFeedbackMessage(undefined)).toEqual({ ok: false, error: 'Mensagem é obrigatória' })
    expect(validateFeedbackMessage(42)).toEqual({ ok: false, error: 'Mensagem é obrigatória' })
  })

  it('deve aceitar mensagem no limite de caracteres', () => {
    const result = validateFeedbackMessage('a'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH))
    expect(result.ok).toBe(true)
  })

  it('deve recusar mensagem acima do limite de caracteres', () => {
    const result = validateFeedbackMessage('a'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1))
    expect(result).toEqual({
      ok: false,
      error: `Mensagem deve ter no máximo ${FEEDBACK_MESSAGE_MAX_LENGTH} caracteres`,
    })
  })
})
