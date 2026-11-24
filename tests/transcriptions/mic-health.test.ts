import { describe, it, expect } from 'vitest'
import {
  getMicAlert,
  levelForMeter,
  rmsFromTimeDomain,
  SILENCE_ALERT_SECONDS,
  SILENCE_RMS_THRESHOLD,
} from '@/lib/transcriptions/mic-health'

const OK = { trackEnded: false, trackMuted: false, recorderError: false, silentSeconds: 0 }

describe('rmsFromTimeDomain', () => {
  it('silêncio digital (microfone mudo) dá zero', () => {
    expect(rmsFromTimeDomain(new Uint8Array(1024).fill(128))).toBe(0)
  })

  it('onda cheia dá ~1 e fica bem acima do limiar de silêncio', () => {
    const square = Array.from({ length: 1024 }, (_, i) => (i % 2 ? 255 : 0))
    expect(rmsFromTimeDomain(square)).toBeGreaterThan(0.99)
  })

  it('ruído de 1 unidade fica abaixo do limiar', () => {
    const hiss = Array.from({ length: 1024 }, (_, i) => (i % 2 ? 129 : 127))
    expect(rmsFromTimeDomain(hiss)).toBeLessThan(SILENCE_RMS_THRESHOLD * 2)
  })

  it('array vazio dá zero', () => {
    expect(rmsFromTimeDomain([])).toBe(0)
  })
})

describe('levelForMeter', () => {
  it('limita entre 0 e 1', () => {
    expect(levelForMeter(0)).toBe(0)
    expect(levelForMeter(0.001)).toBe(0)
    expect(levelForMeter(1)).toBe(1)
    expect(levelForMeter(0.03)).toBeGreaterThan(0)
    expect(levelForMeter(0.03)).toBeLessThan(1)
  })
})

describe('getMicAlert', () => {
  it('sem problema, sem alerta', () => {
    expect(getMicAlert(OK)).toBeNull()
  })

  it('silêncio curto não alerta', () => {
    expect(getMicAlert({ ...OK, silentSeconds: SILENCE_ALERT_SECONDS - 1 })).toBeNull()
  })

  it('silêncio de 30 s alerta', () => {
    expect(getMicAlert({ ...OK, silentSeconds: SILENCE_ALERT_SECONDS })?.kind).toBe('silent')
  })

  it('microfone pausado pelo aparelho alerta na hora', () => {
    expect(getMicAlert({ ...OK, trackMuted: true })?.kind).toBe('muted')
  })

  it('microfone desconectado tem prioridade sobre os outros', () => {
    expect(getMicAlert({ trackEnded: true, trackMuted: true, recorderError: false, silentSeconds: 99 })?.kind).toBe('ended')
    expect(getMicAlert({ ...OK, recorderError: true })?.kind).toBe('ended')
  })
})
