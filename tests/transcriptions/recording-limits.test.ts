import { describe, it, expect } from 'vitest'
import {
  MAX_RECORDING_SECONDS,
  WARNING_BEFORE_SECONDS,
  getRecordingLimitState,
} from '@/lib/transcriptions/recording-limits'

describe('getRecordingLimitState', () => {
  it('30 min de teto e aviso 2 min antes', () => {
    expect(MAX_RECORDING_SECONDS).toBe(30 * 60)
    expect(WARNING_BEFORE_SECONDS).toBe(2 * 60)
  })

  it('início da gravação: sem parar, sem aviso', () => {
    const state = getRecordingLimitState(0)
    expect(state).toEqual({ shouldStop: false, showWarning: false, secondsUntilStop: 1800 })
  })

  it('antes da janela de aviso (27:59): sem aviso', () => {
    const state = getRecordingLimitState(27 * 60 + 59)
    expect(state.shouldStop).toBe(false)
    expect(state.showWarning).toBe(false)
    expect(state.secondsUntilStop).toBe(121)
  })

  it('entrando na janela de aviso (exatamente 28:00): mostra aviso', () => {
    const state = getRecordingLimitState(28 * 60)
    expect(state.shouldStop).toBe(false)
    expect(state.showWarning).toBe(true)
    expect(state.secondsUntilStop).toBe(120)
  })

  it('dentro da janela de aviso (29:30): mostra aviso com contagem regressiva', () => {
    const state = getRecordingLimitState(29 * 60 + 30)
    expect(state.shouldStop).toBe(false)
    expect(state.showWarning).toBe(true)
    expect(state.secondsUntilStop).toBe(30)
  })

  it('exatamente no teto (30:00): para e não mostra mais aviso', () => {
    const state = getRecordingLimitState(30 * 60)
    expect(state.shouldStop).toBe(true)
    expect(state.showWarning).toBe(false)
    expect(state.secondsUntilStop).toBe(0)
  })

  it('depois do teto (35:00): continua sinalizando parada', () => {
    const state = getRecordingLimitState(35 * 60)
    expect(state.shouldStop).toBe(true)
    expect(state.showWarning).toBe(false)
    expect(state.secondsUntilStop).toBe(0)
  })
})
