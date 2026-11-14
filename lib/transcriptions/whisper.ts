import OpenAI from 'openai'

// Transcreve o áudio da consulta a partir de uma signed URL do Supabase
// Storage (curta duração — ver app/api/transcriptions/process/route.ts).
// Client instanciado dentro da função (não no module scope): o SDK da OpenAI
// valida a apiKey na construção e lança erro se estiver vazia — no module
// scope isso quebra a coleta de dados de rota do `next build` quando
// OPENAI_API_KEY ainda não foi configurada localmente.
// O gpt-4o-mini-transcribe é bem mais rápido que o whisper-1, mas recusa áudio
// acima de 1500s (25 min). A gravação vai até 30 min
// (lib/transcriptions/recording-limits.ts), então consulta longa, ou sem
// duração conhecida, continua no whisper-1. A margem cobre a diferença entre a
// duração medida no navegador e a que a OpenAI mede no arquivo.
export const FAST_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'
export const FALLBACK_TRANSCRIPTION_MODEL = 'whisper-1'
const FAST_MODEL_MAX_SECONDS = 1400

export function pickConsultationModel(durationSeconds: number | null | undefined): string {
  if (!durationSeconds || durationSeconds <= 0 || durationSeconds > FAST_MODEL_MAX_SECONDS) {
    return FALLBACK_TRANSCRIPTION_MODEL
  }
  return FAST_TRANSCRIPTION_MODEL
}

export async function transcribeAudio(
  audioUrl: string,
  model: string = FALLBACK_TRANSCRIPTION_MODEL
): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? 'audio/webm'
  const blob = new Blob([arrayBuffer], { type: contentType })
  const file = new File([blob], 'recording.webm', { type: contentType })

  const transcription = await openai.audio.transcriptions.create({
    file,
    model,
    language: process.env.WHISPER_LANGUAGE ?? 'pt',
    response_format: 'text',
  })

  return transcription as unknown as string
}

/**
 * Transcreve um áudio já baixado (ex.: áudio do paciente no WhatsApp) e
 * devolve também a duração que o Whisper mediu — usada para cobrar e para
 * conferir o limite quando o arquivo não informa a duração.
 */
export async function transcribeAudioBytes(
  bytes: ArrayBuffer,
  mime: string,
  filename: string
): Promise<{ text: string; durationSeconds: number }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const file = new File([new Blob([bytes], { type: mime })], filename, { type: mime })
  const result = (await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: process.env.WHISPER_LANGUAGE ?? 'pt',
    response_format: 'verbose_json',
  })) as unknown as { text?: string; duration?: number }
  return { text: (result.text ?? '').trim(), durationSeconds: Number(result.duration) || 0 }
}
