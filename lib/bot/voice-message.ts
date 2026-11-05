// Áudio do paciente no WhatsApp. O MedScale baixa o arquivo, transcreve com o
// Whisper e a Clara recebe o texto. Áudio acima de 2 minutos não é transcrito:
// a Clara pede um áudio mais curto ou texto.
//
// LGPD: áudio e transcrição são dados do paciente. Log só com ids, tamanho,
// duração e motivo — nunca o texto.

import { decryptToken } from '@/lib/crypto'
import { getBotConfig } from '@/lib/bot/config'
import { downloadWhatsAppMedia } from '@/lib/bot/insurance-card'
import { transcribeAudioBytes } from '@/lib/transcriptions/whisper'
import { recordWhisperCost } from '@/lib/costs/record'

export const VOICE_MAX_SECONDS = 120

// Teto de tamanho antes de baixar. Áudio de voz do WhatsApp (Opus) tem uns
// 16–32 kbps: 2 minutos ficam bem abaixo de 1 MB. 4 MB cobre áudio em formato
// mais pesado (MP3/M4A) sem deixar passar arquivo enorme para o Whisper.
export const VOICE_MAX_BYTES = 4 * 1024 * 1024

// Formatos que o Whisper aceita, com a extensão que ele usa para reconhecer.
const AUDIO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

export function normalizeAudioMime(mime: string | null | undefined): string | null {
  const base = mime?.split(';')[0].trim().toLowerCase()
  return base && base in AUDIO_EXT ? base : null
}

/** Texto que a Clara recebe no lugar do áudio. */
export function voiceTranscriptMessage(text: string): string {
  return `[Áudio do paciente, transcrito automaticamente]\n${text}`
}

export const VOICE_TOO_LONG_REPLY =
  'Recebi seu áudio, mas ele passou de 2 minutos e não consigo ouvir. Pode mandar um áudio mais curto ou escrever o que você precisa? 🙂'

/**
 * Duração de um arquivo OGG/Opus (o formato do áudio de voz do WhatsApp), lida
 * do próprio arquivo: a última página OGG guarda a posição final em amostras
 * de 48 kHz. Devolve null se o arquivo não for OGG/Opus ou estiver estranho.
 */
export function oggOpusDurationSeconds(buffer: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (bytes.length < 28 || !isOggPage(bytes, 0)) return null

  // OpusHead fica no primeiro pacote, depois do cabeçalho da página (27 bytes)
  // e da tabela de segmentos: "OpusHead" + versão + canais + pre-skip.
  const headStart = 27 + bytes[26]
  const opusHead = String.fromCharCode(...bytes.slice(headStart, headStart + 8))
  if (opusHead !== 'OpusHead') return null
  const preSkip = view.getUint16(headStart + 10, true)

  for (let i = bytes.length - 27; i >= 0; i--) {
    if (!isOggPage(bytes, i)) continue
    const granule = view.getBigInt64(i + 6, true)
    if (granule < BigInt(0)) return null
    const seconds = (Number(granule) - preSkip) / 48000
    return seconds > 0 ? seconds : null
  }
  return null
}

function isOggPage(bytes: Uint8Array, at: number): boolean {
  return bytes[at] === 0x4f && bytes[at + 1] === 0x67 && bytes[at + 2] === 0x67 && bytes[at + 3] === 0x53
}

export type VoiceResult =
  | { kind: 'text'; text: string }
  | { kind: 'too_long' }
  | { kind: 'failed' }

export async function receiveVoiceMessage(params: {
  accountId: string
  mediaId: string
  fetchImpl?: typeof fetch
  transcribe?: typeof transcribeAudioBytes
}): Promise<VoiceResult> {
  const { accountId, mediaId } = params
  const transcribe = params.transcribe ?? transcribeAudioBytes

  const botConfig = await getBotConfig(accountId)
  if (!botConfig?.isActive || !botConfig.metaToken) return { kind: 'failed' }

  const download = await downloadWhatsAppMedia(mediaId, decryptToken(botConfig.metaToken), params.fetchImpl, {
    normalizeMime: normalizeAudioMime,
    maxBytes: VOICE_MAX_BYTES,
  })
  if (!download.ok) {
    console.warn(`[voice] rejected reason=${download.reason} account=${accountId}`)
    // Arquivo grande demais já é áudio longo demais na prática.
    return download.reason === 'too_large' ? { kind: 'too_long' } : { kind: 'failed' }
  }

  // Confere a duração antes de pagar o Whisper, quando o arquivo informa.
  const fileSeconds = oggOpusDurationSeconds(download.bytes)
  if (fileSeconds !== null && fileSeconds > VOICE_MAX_SECONDS) {
    console.warn(`[voice] rejected reason=too_long seconds=${Math.round(fileSeconds)} account=${accountId}`)
    return { kind: 'too_long' }
  }

  try {
    const { text, durationSeconds } = await transcribe(
      download.bytes,
      download.mime,
      `audio.${AUDIO_EXT[download.mime]}`
    )
    await recordWhisperCost({
      ctx: { accountId },
      durationSeconds,
      transcriptionId: null,
      source: 'whatsapp_audio',
    })
    // Formato sem duração no arquivo (MP3/M4A): confere pela duração do Whisper.
    if (durationSeconds > VOICE_MAX_SECONDS) {
      console.warn(`[voice] rejected reason=too_long seconds=${Math.round(durationSeconds)} account=${accountId}`)
      return { kind: 'too_long' }
    }
    if (!text) return { kind: 'failed' }
    console.log(`[voice] transcribed seconds=${Math.round(durationSeconds)} bytes=${download.bytes.byteLength} account=${accountId}`)
    return { kind: 'text', text }
  } catch {
    console.error(`[voice] transcription_failed account=${accountId}`)
    return { kind: 'failed' }
  }
}
