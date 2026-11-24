// Saúde do microfone durante a gravação de consulta (RecordingButton.tsx).
// Em 17/11/2026 o microfone de um médico ficou mudo no 5º minuto e o
// MediaRecorder seguiu "gravando" silêncio até o teto de 30 min, sem ninguém
// perceber. Aqui fica a lógica pura que decide quando avisar.

// Abaixo disso o sinal é ruído de fundo (≈ -46 dBFS). Fala numa sala, mesmo
// baixa e a 1-2 m do celular, passa com folga.
export const SILENCE_RMS_THRESHOLD = 0.005

// Pausa natural de consulta (médico lendo exame, escrevendo) cabe aqui.
export const SILENCE_ALERT_SECONDS = 30

// RMS do sinal a partir de getByteTimeDomainData (bytes 0-255, 128 = zero).
export function rmsFromTimeDomain(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

// 0-1 para a barrinha de volume: escala em dB entre -50 e -10 dBFS.
export function levelForMeter(rms: number): number {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db + 50) / 40))
}

export type MicStatus = {
  trackEnded: boolean
  trackMuted: boolean
  recorderError: boolean
  silentSeconds: number
}

export type MicAlert = { kind: 'ended' | 'muted' | 'silent'; message: string }

export function getMicAlert(status: MicStatus): MicAlert | null {
  if (status.trackEnded || status.recorderError) {
    return {
      kind: 'ended',
      message:
        'O microfone foi desconectado e a gravação parou de captar som. Encerre e grave de novo o restante da consulta.',
    }
  }
  if (status.trackMuted) {
    return {
      kind: 'muted',
      message:
        'O microfone foi pausado pelo aparelho (tela bloqueada, outro app ou ligação). Volte para esta tela e confira se o som voltou a entrar.',
    }
  }
  if (status.silentSeconds >= SILENCE_ALERT_SECONDS) {
    return {
      kind: 'silent',
      message: `Nenhum som captado há ${Math.floor(status.silentSeconds)} s. Confira se o microfone está funcionando.`,
    }
  }
  return null
}
