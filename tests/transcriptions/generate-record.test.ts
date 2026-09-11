import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  generateSOAP: null as unknown as MockFn,
  notifyTranscriptionFailed: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/transcriptions/generate-soap', () => ({
  generateSOAP: (...args: unknown[]) => g.generateSOAP(...args),
}))
vi.mock('@/lib/transcriptions/notify-error', () => ({
  notifyTranscriptionFailed: (...args: unknown[]) => g.notifyTranscriptionFailed(...args),
}))

import { POST as generateRecordRoute } from '@/app/api/transcriptions/generate-record/route'

const CRON_SECRET = 'cron-secret-test'
const SOAP_RECORD = { soap: {}, resumo: 'resumo', alertas: [] }

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ transcriptions: { select: { data: null }, update: { data: null } }, ...config })
  return g.supabase
}

function transcribedRow(overrides: Record<string, unknown> = {}) {
  return {
    transcript_text: 'Paciente relata dor de cabeça.',
    retry_count: 0,
    workspace_id: 'w1',
    account_id: 'a1',
    recorded_by: 'u1',
    patient_id: 'p1',
    ...overrides,
  }
}

function request(body: unknown, secret: string | null = CRON_SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://app.test/api/transcriptions/generate-record', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as never
}

describe('POST /api/transcriptions/generate-record — etapa Claude/SOAP', () => {
  beforeEach(() => {
    g.notifyTranscriptionFailed = vi.fn(async () => {})
  })

  it('deve marcar draft_ready quando o Claude responde com sucesso', async () => {
    g.generateSOAP = vi.fn(async () => SOAP_RECORD)
    const supabase = setup({ transcriptions: { select: { data: transcribedRow() }, update: { data: null } } })

    const res = await generateRecordRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(200)
    const updates = supabase.callsTo('transcriptions', 'update')
    expect(updates.at(-1)?.payload).toMatchObject({ status: 'draft_ready', medical_record_draft: SOAP_RECORD })
    expect(g.notifyTranscriptionFailed).not.toHaveBeenCalled()
  })

  it('deve marcar error e notificar o médico quando o Claude falha na terceira tentativa', async () => {
    g.generateSOAP = vi.fn(async () => {
      throw new Error('Claude indisponível')
    })
    const supabase = setup({
      transcriptions: { select: { data: transcribedRow({ retry_count: 2 }) }, update: { data: null } },
    })

    const res = await generateRecordRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    const final = supabase.callsTo('transcriptions', 'update').at(-1)
    expect(final?.payload).toMatchObject({ status: 'error' })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(g.notifyTranscriptionFailed).toHaveBeenCalledWith({
      id: 't1',
      workspace_id: 'w1',
      patient_id: 'p1',
      recorded_by: 'u1',
    })
  })

  it('não deve notificar quando ainda há tentativas automáticas restantes', async () => {
    g.generateSOAP = vi.fn(async () => {
      throw new Error('Claude timeout')
    })
    setup({ transcriptions: { select: { data: transcribedRow({ retry_count: 0 }) }, update: { data: null } } })

    const res = await generateRecordRoute(request({ transcription_id: 't1' }))

    expect(res.status).toBe(500)
    expect(g.notifyTranscriptionFailed).not.toHaveBeenCalled()
  })
})
