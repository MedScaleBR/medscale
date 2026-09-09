// Teto de duração da gravação de consulta feita no navegador
// (components/transcriptions/RecordingButton.tsx). O MediaRecorder grava
// client-side e o áudio vai pro Whisper (`whisper-1`), que rejeita arquivos
// acima de 25 MB — ~40-50 min de `webm/opus`. 30 min deixa margem folgada e
// evita gravações esquecidas rodando indefinidamente.
export const MAX_RECORDING_SECONDS = 30 * 60

// Quanto antes do teto o aviso de encerramento automático aparece.
export const WARNING_BEFORE_SECONDS = 2 * 60

export type RecordingLimitState = {
  shouldStop: boolean
  showWarning: boolean
  secondsUntilStop: number
}

// Lógica pura consumida pelo tick de 1s do RecordingButton.
export function getRecordingLimitState(elapsedSeconds: number): RecordingLimitState {
  const secondsUntilStop = Math.max(0, MAX_RECORDING_SECONDS - elapsedSeconds)
  return {
    shouldStop: elapsedSeconds >= MAX_RECORDING_SECONDS,
    showWarning: secondsUntilStop <= WARNING_BEFORE_SECONDS && secondsUntilStop > 0,
    secondsUntilStop,
  }
}
