import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  notifyTranscriptionFailed: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/transcriptions/notify-error', () => ({
  notifyTranscriptionFailed: (...args: unknown[]) => g.notifyTranscriptionFailed(...args),
}))

import { POST as stuckRoute } from '@/app/api/cron/stuck-transcriptions/route'

const CRON_SECRET = 'cron-secret-test'

function stuckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'transcribing',
    retry_count: 0,
    workspace_id: 'w1',
    account_id: 'a1',
    patient_id: 'p1',
    patient_name: null,
    recorded_by: 'u1',
    ...overrides,
  }
}

function setup(rows: unknown[], config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    transcriptions: {
      select: [{ data: rows }, { data: [{ id: 't1' }] }],
      update: { data: [{ id: 't1' }] },
    },
    ...config,
  })
  return g.supabase
}

function request(secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/cron/stuck-transcriptions', {
    method: 'POST',
    headers,
    body: '{}',
  }) as never
}

describe('POST /api/cron/stuck-transcriptions', () => {
  beforeEach(() => {
    g.notifyTranscriptionFailed = vi.fn(async () => {})
  })

  it('exige o segredo de cron', async () => {
    setup([])
    const res = await stuckRoute(request(null))
    expect(res.status).toBe(401)
  })

  it('só olha linhas paradas há mais de 6 min e há menos de 2h', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
    try {
      const supabase = setup([])
      await stuckRoute(request())

      const query = supabase.callsTo('transcriptions', 'select')[0]
      expect(query.filters).toContainEqual(['in', 'status', ['transcribing', 'generating']])
      expect(query.filters).toContainEqual(['lt', 'updated_at', '2026-11-14T11:54:00.000Z'])
      expect(query.filters).toContainEqual(['gt', 'updated_at', '2026-11-14T10:00:00.000Z'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('volta transcrição travada para pending e re-dispara o Whisper', async () => {
    const supabase = setup([stuckRow()])
    const res = await stuckRoute(request())

    expect(await res.json()).toMatchObject({ retried: 1, failed: 0 })
    const update = supabase.callsTo('transcriptions', 'update')[0]
    expect(update.payload).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(update.filters).toContainEqual(['eq', 'status', 'transcribing'])
    expect(supabase.rpc).toHaveBeenCalledWith(
      'trigger_transcription_process',
      expect.objectContaining({ p_transcription_id: 't1' })
    )
  })

  it('volta SOAP travado para transcribed e re-dispara a geração', async () => {
    const supabase = setup([stuckRow({ status: 'generating' })])
    await stuckRoute(request())

    expect(supabase.callsTo('transcriptions', 'update')[0].payload).toMatchObject({ status: 'transcribed' })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'trigger_transcription_generate',
      expect.objectContaining({ p_transcription_id: 't1' })
    )
  })

  it('na terceira tentativa marca erro e avisa o médico, sem re-disparar', async () => {
    const supabase = setup([stuckRow({ retry_count: 2 })])
    const res = await stuckRoute(request())

    expect(await res.json()).toMatchObject({ retried: 0, failed: 1 })
    expect(supabase.callsTo('transcriptions', 'update')[0].payload).toMatchObject({ status: 'error' })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(g.notifyTranscriptionFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('não re-dispara quando a rota terminou entre a busca e o update', async () => {
    const supabase = setup([stuckRow()], {
      transcriptions: { select: { data: [stuckRow()] }, update: { data: [] } },
    })
    const res = await stuckRoute(request())

    expect(await res.json()).toMatchObject({ retried: 0, failed: 0 })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
