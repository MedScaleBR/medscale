import { describe, it, expect, beforeEach, vi } from 'vitest'

const g = vi.hoisted(() => ({
  botConfig: { isActive: true, metaToken: 'enc:tok' } as { isActive: boolean; metaToken: string | null } | null,
  recordWhisperCost: vi.fn(async () => undefined),
}))

vi.mock('@/lib/bot/config', () => ({ getBotConfig: async () => g.botConfig, getAccountUnits: async () => [] }))
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => t.replace(/^enc:/, '') }))
vi.mock('@/lib/costs/record', () => ({ recordWhisperCost: g.recordWhisperCost }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }))

import {
  oggOpusDurationSeconds,
  normalizeAudioMime,
  receiveVoiceMessage,
  voiceTranscriptMessage,
  VOICE_MAX_BYTES,
} from '@/lib/bot/voice-message'

// Página OGG mínima: "OggS", versão, flags, granule (8 bytes LE), serial,
// sequência, CRC, 1 segmento com `payload.length` bytes.
function oggPage(granule: bigint, payload: Uint8Array): Uint8Array {
  const page = new Uint8Array(28 + payload.length)
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53], 0)
  view.setBigInt64(6, granule, true)
  page[26] = 1
  page[27] = payload.length
  page.set(payload, 28)
  return page
}

function opusHead(preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'), 0)
  head[8] = 1
  head[9] = 1
  new DataView(head.buffer).setUint16(10, preSkip, true)
  return head
}

function oggOpusFile(seconds: number, preSkip = 312): ArrayBuffer {
  const pages = [
    oggPage(BigInt(0), opusHead(preSkip)),
    oggPage(BigInt(0), new Uint8Array(10)),
    oggPage(BigInt(Math.round(seconds * 48000) + preSkip), new Uint8Array(40)),
  ]
  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of pages) {
    out.set(p, at)
    at += p.length
  }
  return out.buffer
}

function fakeFetch(file: ArrayBuffer, meta: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('graph.facebook.com')) {
      return new Response(JSON.stringify({ url: 'https://lookaside.test/a', mime_type: 'audio/ogg; codecs=opus', file_size: file.byteLength, ...meta }))
    }
    return new Response(file)
  }) as unknown as typeof fetch
}

describe('oggOpusDurationSeconds', () => {
  it('lê a duração do áudio de voz', () => {
    expect(oggOpusDurationSeconds(oggOpusFile(37.5))).toBeCloseTo(37.5, 2)
  })

  it('não é OGG → null', () => {
    expect(oggOpusDurationSeconds(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull()
    expect(oggOpusDurationSeconds(new TextEncoder().encode('ID3'.padEnd(64, 'x')).buffer as ArrayBuffer)).toBeNull()
  })
})

describe('normalizeAudioMime', () => {
  it('aceita os formatos do WhatsApp que o Whisper entende', () => {
    expect(normalizeAudioMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(normalizeAudioMime('audio/mpeg')).toBe('audio/mpeg')
    expect(normalizeAudioMime('audio/amr')).toBeNull()
    expect(normalizeAudioMime(null)).toBeNull()
  })
})

describe('voiceTranscriptMessage', () => {
  it('avisa a Clara que o texto veio de um áudio', () => {
    expect(voiceTranscriptMessage('quero marcar')).toBe('[Áudio do paciente, transcrito automaticamente]\nquero marcar')
  })
})

describe('receiveVoiceMessage', () => {
  beforeEach(() => {
    g.botConfig = { isActive: true, metaToken: 'enc:tok' }
    g.recordWhisperCost.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('transcreve áudio de até 2 minutos e registra o custo', async () => {
    const transcribe = vi.fn(async () => ({ text: 'quero marcar consulta', durationSeconds: 37.5 }))

    const result = await receiveVoiceMessage({ accountId: 'acc1', mediaId: 'm1', fetchImpl: fakeFetch(oggOpusFile(37.5)), transcribe })

    expect(result).toEqual({ kind: 'text', text: 'quero marcar consulta' })
    expect(transcribe).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'audio/ogg', 'audio.ogg')
    expect(g.recordWhisperCost).toHaveBeenCalledWith({
      ctx: { accountId: 'acc1' },
      durationSeconds: 37.5,
      transcriptionId: null,
      source: 'whatsapp_audio',
    })
  })

  it('áudio de voz acima de 2 minutos nem chega ao Whisper', async () => {
    const transcribe = vi.fn()

    const result = await receiveVoiceMessage({ accountId: 'acc1', mediaId: 'm1', fetchImpl: fakeFetch(oggOpusFile(121)), transcribe })

    expect(result).toEqual({ kind: 'too_long' })
    expect(transcribe).not.toHaveBeenCalled()
    expect(g.recordWhisperCost).not.toHaveBeenCalled()
  })

  it('formato sem duração no arquivo: confere pela duração do Whisper', async () => {
    const mp3 = new TextEncoder().encode('ID3'.padEnd(200, 'x')).buffer as ArrayBuffer
    const transcribe = vi.fn(async () => ({ text: 'texto longo', durationSeconds: 150 }))

    const result = await receiveVoiceMessage({
      accountId: 'acc1',
      mediaId: 'm1',
      fetchImpl: fakeFetch(mp3, { mime_type: 'audio/mpeg' }),
      transcribe,
    })

    expect(result).toEqual({ kind: 'too_long' })
    expect(g.recordWhisperCost).toHaveBeenCalled()
  })

  it('arquivo grande demais conta como áudio longo, sem baixar', async () => {
    const fetchImpl = fakeFetch(oggOpusFile(10), { file_size: VOICE_MAX_BYTES + 1 })

    const result = await receiveVoiceMessage({ accountId: 'acc1', mediaId: 'm1', fetchImpl, transcribe: vi.fn() })

    expect(result).toEqual({ kind: 'too_long' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('formato que o Whisper não entende → falha (Clara pede texto)', async () => {
    const result = await receiveVoiceMessage({
      accountId: 'acc1',
      mediaId: 'm1',
      fetchImpl: fakeFetch(oggOpusFile(10), { mime_type: 'audio/amr' }),
      transcribe: vi.fn(),
    })
    expect(result).toEqual({ kind: 'failed' })
  })

  it('erro no Whisper → falha, sem quebrar', async () => {
    const transcribe = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await receiveVoiceMessage({ accountId: 'acc1', mediaId: 'm1', fetchImpl: fakeFetch(oggOpusFile(10)), transcribe })
    expect(result).toEqual({ kind: 'failed' })
  })

  it('Clara desligada não transcreve', async () => {
    g.botConfig = { isActive: false, metaToken: 'enc:tok' }
    const transcribe = vi.fn()
    const result = await receiveVoiceMessage({ accountId: 'acc1', mediaId: 'm1', fetchImpl: fakeFetch(oggOpusFile(10)), transcribe })
    expect(result).toEqual({ kind: 'failed' })
    expect(transcribe).not.toHaveBeenCalled()
  })
})
