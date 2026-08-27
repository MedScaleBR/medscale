import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  transcribeAudio: null as unknown as MockFn,
  openaiCreate: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/transcriptions/whisper', () => ({
  transcribeAudio: (...args: unknown[]) => g.transcribeAudio(...args),
}))
vi.mock('openai', () => ({
  default: class {
    audio = { transcriptions: { create: (...args: unknown[]) => g.openaiCreate(...args) } }
  },
}))

import { POST as processRoute } from '@/app/api/transcriptions/process/route'

const CRON_SECRET = 'cron-secret-test'
const TRANSCRIPT = 'Paciente relata dor de cabeça há três dias.'

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ transcriptions: { select: { data: null }, update: { data: null } }, ...config })
  return g.supabase
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'pending',
    audio_path: 'w1/a1/123.webm',
    retry_count: 0,
    transcript_text: null,
    ...overrides,
  }
}

function request(body: unknown, secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/transcriptions/process', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as never
}

describe('POST /api/transcriptions/process — etapa Whisper', () => {
  beforeEach(() => {
    g.transcribeAudio = vi.fn(async () => TRANSCRIPT)
  })

  it('deve retornar 401 quando o header de autorização está ausente', async () => {
    setup()
    const res = await processRoute(request({ transcription_id: 't1' }, null))

    expect(res.status).toBe(401)
    expect(g.transcribeAudio).not.toHaveBeenCalled()
  })

  it('deve retornar 401 quando o segredo de cron está errado', async () => {
    setup()
    const res = await processRoute(request({ transcription_id: 't1' }, 'segredo-errado'))
    expect(res.status).toBe(401)
  })

  it('deve retornar 404 quando o transcription_id não existe', async () => {
    setup({ transcriptions: { select: { data: null }, update: { data: null } } })
    const res = await processRoute(request({ transcription_id: 'inexistente' }))

    expect(res.status).toBe(404)
  })

  it('deve retornar 200 sem reprocessar quando a transcrição já está assinada', async () => {
    const supabase = setup({
      transcriptions: { select: { data: pendingRow({ status: 'signed' }) }, update: { data: null } },
    })
    const res = await processRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(200)
    expect(g.transcribeAudio).not.toHaveBeenCalled()
    expect(supabase.callsTo('transcriptions', 'update')).toHaveLength(0)
  })

  it('deve salvar o texto, marcar transcribed e disparar a geração quando o Whisper responde', async () => {
    const supabase = setup({ transcriptions: { select: { data: pendingRow() }, update: { data: null } } })
    const res = await processRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(200)
    const updates = supabase.callsTo('transcriptions', 'update')
    expect(updates[0].payload).toEqual({ status: 'transcribing' })
    expect(updates.at(-1)?.payload).toEqual({
      transcript_text: TRANSCRIPT,
      status: 'transcribed',
      retry_count: 0,
      error_message: null,
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'trigger_transcription_generate',
      expect.objectContaining({ p_transcription_id: 't1' })
    )
  })

  it('deve transcrever a partir da signed URL do Storage', async () => {
    const supabase = setup({ transcriptions: { select: { data: pendingRow() }, update: { data: null } } })
    await processRoute(request({ transcription_id: 't1' }))

    expect(supabase.storage.createSignedUrl).toHaveBeenCalledWith('w1/a1/123.webm', 3600)
    expect(g.transcribeAudio).toHaveBeenCalledWith('https://storage.test/audio.webm')
  })

  it('deve voltar para pending com retry_count 1 e re-disparar quando o Whisper falha na primeira tentativa', async () => {
    g.transcribeAudio = vi.fn(async () => {
      throw new Error('Whisper timeout')
    })
    const supabase = setup({ transcriptions: { select: { data: pendingRow({ retry_count: 0 }) }, update: { data: null } } })
    const res = await processRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(String((final?.payload as { error_message: string }).error_message)).toContain('Whisper timeout')
    expect(supabase.rpc).toHaveBeenCalledWith(
      'trigger_transcription_process',
      expect.objectContaining({ p_transcription_id: 't1' })
    )
  })

  it('deve marcar error e não re-disparar quando o Whisper falha na terceira tentativa', async () => {
    g.transcribeAudio = vi.fn(async () => {
      throw new Error('Whisper indisponível')
    })
    const supabase = setup({ transcriptions: { select: { data: pendingRow({ retry_count: 2 }) }, update: { data: null } } })
    const res = await processRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'error' })
    expect(String((final?.payload as { error_message: string }).error_message)).toContain('Whisper indisponível')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deve cair no retry quando a signed URL do Storage não pode ser gerada', async () => {
    const supabase = setup({ transcriptions: { select: { data: pendingRow() }, update: { data: null } } })
    supabase.storage.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'objeto não encontrado' } })

    const res = await processRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    expect(g.transcribeAudio).not.toHaveBeenCalled()
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(String((final?.payload as { error_message: string }).error_message)).toContain('Could not generate signed URL')
  })
})

describe('transcribeAudio — integração com o Whisper', () => {
  beforeEach(() => {
    setup()
    g.openaiCreate = vi.fn(async () => TRANSCRIPT)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/webm' } }))
    )
  })

  it('deve devolver o texto transcrito do áudio baixado da signed URL', async () => {
    const { transcribeAudio: real } = await vi.importActual<typeof import('@/lib/transcriptions/whisper')>(
      '@/lib/transcriptions/whisper'
    )
    await expect(real('https://storage.test/audio.webm')).resolves.toBe(TRANSCRIPT)
    expect(g.openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1', language: 'pt', response_format: 'text' })
    )
  })

  it('deve lançar quando o download do áudio falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { transcribeAudio: real } = await vi.importActual<typeof import('@/lib/transcriptions/whisper')>(
      '@/lib/transcriptions/whisper'
    )
    await expect(real('https://storage.test/sumiu.webm')).rejects.toThrow(/Failed to fetch audio: 404/)
    expect(g.openaiCreate).not.toHaveBeenCalled()
  })
})
