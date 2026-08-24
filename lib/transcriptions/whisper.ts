import OpenAI from 'openai'

// Transcreve o áudio da consulta a partir de uma signed URL do Supabase
// Storage (curta duração — ver app/api/transcriptions/process/route.ts).
// Client instanciado dentro da função (não no module scope): o SDK da OpenAI
// valida a apiKey na construção e lança erro se estiver vazia — no module
// scope isso quebra a coleta de dados de rota do `next build` quando
// OPENAI_API_KEY ainda não foi configurada localmente.
export async function transcribeAudio(audioUrl: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? 'audio/webm'
  const blob = new Blob([arrayBuffer], { type: contentType })
  const file = new File([blob], 'recording.webm', { type: contentType })

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: process.env.WHISPER_LANGUAGE ?? 'pt',
    response_format: 'text',
  })

  return transcription as unknown as string
}
