import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  session: null as null | { userId: string; accountId: string; workspaceId: string; role: string; modules: string[] },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))
vi.mock('@/lib/session/api', async () => {
  const { NextResponse: NR } = await import('next/server')
  return {
    requireWorkspaceSession: async () =>
      g.session ? { session: g.session } : { error: NR.json({ error: 'Unauthorized' }, { status: 401 }) },
    requireModule: (session: { modules: string[] }, mod: string) =>
      session.modules.includes(mod)
        ? null
        : NR.json({ error: `Módulo '${mod}' não está ativo no seu plano` }, { status: 403 }),
  }
})

import { POST as createTranscription } from '@/app/api/transcriptions/route'
import { POST as uploadUrl } from '@/app/api/transcriptions/upload-url/route'

const SESSION = { userId: 'u1', accountId: 'acc1', workspaceId: 'w1', role: 'owner', modules: ['transcriptions'] }

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({
    transcriptions: { insert: { data: { id: 't-nova' } }, select: { data: null } },
    ...config,
  })
  return g.supabase
}

function request(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const validBody = {
  audio_path: 'w1/appt-1/1737000000000.webm',
  appointment_id: 'appt-1',
  patient_id: 'p1',
  consent_confirmed: true,
  duration_seconds: 420,
}

// O áudio nunca passa por esta rota: o browser sobe direto para o Storage com
// a signed upload URL emitida por /api/transcriptions/upload-url (funções
// serverless da Vercel têm limite de ~4.5MB de corpo). Por isso não existe
// checagem de tamanho de arquivo no servidor — o limite é do bucket.
describe('POST /api/transcriptions/upload-url — emissão da URL de upload', () => {
  beforeEach(() => {
    g.session = { ...SESSION }
    setup()
  })

  it('deve retornar 401 quando não há sessão válida', async () => {
    g.session = null
    const res = await uploadUrl(request('https://app.test/api/transcriptions/upload-url', {}))

    expect(res.status).toBe(401)
  })

  it('deve retornar 403 quando o módulo transcriptions não está ativo', async () => {
    g.session = { ...SESSION, modules: [] }
    const res = await uploadUrl(request('https://app.test/api/transcriptions/upload-url', {}))

    expect(res.status).toBe(403)
  })

  it('deve emitir a URL num caminho dentro da workspace da sessão', async () => {
    const supabase = setup()
    const res = await uploadUrl(
      request('https://app.test/api/transcriptions/upload-url', { appointment_id: 'appt-1', content_type: 'audio/webm' })
    )

    expect(res.status).toBe(200)
    const [path] = supabase.storage.createSignedUploadUrl.mock.calls[0] as unknown as [string]
    expect(path).toMatch(/^w1\/appt-1\/\d+\.webm$/)
  })

  it('deve escolher a extensão conforme o content-type do áudio', async () => {
    const casos: Array<[string, string]> = [
      ['audio/ogg', 'ogg'],
      ['audio/mp4', 'mp4'],
      ['audio/wav', 'wav'],
      ['audio/desconhecido', 'webm'],
    ]
    for (const [contentType, ext] of casos) {
      const supabase = setup()
      await uploadUrl(request('https://app.test/api/transcriptions/upload-url', { content_type: contentType }))
      const [path] = supabase.storage.createSignedUploadUrl.mock.calls[0] as unknown as [string]
      expect(path.endsWith(`.${ext}`), contentType).toBe(true)
    }
  })

  it('deve usar "no-appointment" no caminho quando a gravação não está ligada a uma consulta', async () => {
    const supabase = setup()
    await uploadUrl(request('https://app.test/api/transcriptions/upload-url', {}))

    const [path] = supabase.storage.createSignedUploadUrl.mock.calls[0] as unknown as [string]
    expect(path).toContain('/no-appointment/')
  })

  it('deve retornar 500 quando o Storage recusa emitir a URL', async () => {
    const supabase = setup()
    supabase.storage.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'bucket cheio' } })

    const res = await uploadUrl(request('https://app.test/api/transcriptions/upload-url', {}))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'bucket cheio' })
  })
})

describe('POST /api/transcriptions — criação do registro depois do upload', () => {
  beforeEach(() => {
    g.session = { ...SESSION }
    setup()
  })

  it('deve retornar 401 quando não há sessão válida', async () => {
    g.session = null
    const res = await createTranscription(request('https://app.test/api/transcriptions', validBody))

    expect(res.status).toBe(401)
  })

  it('deve retornar 403 quando o módulo transcriptions não está ativo na account', async () => {
    g.session = { ...SESSION, modules: [] }
    const res = await createTranscription(request('https://app.test/api/transcriptions', validBody))

    expect(res.status).toBe(403)
  })

  it('deve retornar 400 quando consent_confirmed não vem no corpo', async () => {
    const res = await createTranscription(
      request('https://app.test/api/transcriptions', { ...validBody, consent_confirmed: false })
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Consentimento do paciente é obrigatório' })
  })

  it('deve retornar 400 quando patient_id não vem no corpo', async () => {
    const { patient_id, ...semPaciente } = validBody
    void patient_id
    const res = await createTranscription(request('https://app.test/api/transcriptions', semPaciente))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'patient_id é obrigatório' })
  })

  it('deve retornar 400 quando audio_path não vem no corpo', async () => {
    const { audio_path, ...semPath } = validBody
    void audio_path
    const res = await createTranscription(request('https://app.test/api/transcriptions', semPath))

    expect(res.status).toBe(400)
  })

  it('deve retornar 403 quando o audio_path aponta para outra workspace', async () => {
    const res = await createTranscription(
      request('https://app.test/api/transcriptions', { ...validBody, audio_path: 'w2/appt-1/123.webm' })
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'audio_path fora do workspace atual' })
  })

  it('não deve criar registro quando a validação falha', async () => {
    const supabase = setup()
    await createTranscription(request('https://app.test/api/transcriptions', { ...validBody, consent_confirmed: false }))

    expect(supabase.callsTo('transcriptions', 'insert')).toHaveLength(0)
  })

  it('deve criar o registro com status pending e disparar o processamento quando o corpo é válido', async () => {
    const supabase = setup()
    const res = await createTranscription(request('https://app.test/api/transcriptions', validBody))

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ id: 't-nova', status: 'pending' })

    const insert = supabase.callsTo('transcriptions', 'insert')[0]
    expect(insert?.payload).toMatchObject({
      workspace_id: 'w1',
      account_id: 'acc1',
      appointment_id: 'appt-1',
      patient_id: 'p1',
      recorded_by: 'u1',
      audio_path: validBody.audio_path,
      duration_seconds: 420,
      consent_confirmed: true,
      status: 'pending',
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'trigger_transcription_process',
      expect.objectContaining({ p_transcription_id: 't-nova' })
    )
  })

  it('deve retornar 500 quando o insert falha, sem disparar o processamento', async () => {
    const supabase = setup({
      transcriptions: { insert: { data: null, error: { message: 'violação de RLS' } }, select: { data: null } },
    })
    const res = await createTranscription(request('https://app.test/api/transcriptions', validBody))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Falha ao criar registro' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deve aceitar gravação sem consulta associada', async () => {
    const supabase = setup()
    const { appointment_id, ...semConsulta } = validBody
    void appointment_id
    const res = await createTranscription(
      request('https://app.test/api/transcriptions', { ...semConsulta, audio_path: 'w1/no-appointment/123.webm' })
    )

    expect(res.status).toBe(201)
    expect(supabase.callsTo('transcriptions', 'insert')[0].payload).toMatchObject({ appointment_id: null })
  })
})
