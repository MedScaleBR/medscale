import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'
import type { MockFn } from '../helpers/types'

const g = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  sendTranscriptionErrorPush: null as unknown as MockFn,
  broadcastToWorkspace: null as unknown as MockFn,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/realtime/broadcast', () => ({
  broadcastToWorkspace: (...args: unknown[]) => g.broadcastToWorkspace(...args),
}))
vi.mock('@/lib/push/send', () => ({
  sendTranscriptionErrorPush: (...args: unknown[]) => g.sendTranscriptionErrorPush(...args),
}))

import { notifyTranscriptionFailed } from '@/lib/transcriptions/notify-error'

function setup() {
  g.supabase = createSupabaseMock({
    patients: { select: { data: { full_name: 'Ana Souza' } } },
  })
  return g.supabase
}

describe('notifyTranscriptionFailed — avisa o médico quando a transcrição esgota as tentativas', () => {
  beforeEach(() => {
    g.sendTranscriptionErrorPush = vi.fn(async () => {})
    g.broadcastToWorkspace = vi.fn(async () => {})
  })

  it('deve disparar push e broadcast com o nome do paciente e o médico correto', async () => {
    setup()
    await notifyTranscriptionFailed({
      id: 't-1',
      workspace_id: 'w-1',
      patient_id: 'p-1',
      recorded_by: 'u-1',
    })

    expect(g.sendTranscriptionErrorPush).toHaveBeenCalledWith(
      'w-1',
      'u-1',
      expect.objectContaining({ url: '/transcricoes/t-1' })
    )
    expect(g.broadcastToWorkspace).toHaveBeenCalledWith('w-1', 'transcription_error', {
      transcriptionId: 't-1',
      patientName: 'Ana Souza',
      recordedBy: 'u-1',
    })
  })

  it('deve usar "Paciente" quando o nome não é encontrado', async () => {
    g.supabase = createSupabaseMock({ patients: { select: { data: null } } })
    await notifyTranscriptionFailed({
      id: 't-1',
      workspace_id: 'w-1',
      patient_id: 'p-1',
      recorded_by: 'u-1',
    })

    expect(g.broadcastToWorkspace).toHaveBeenCalledWith(
      'w-1',
      'transcription_error',
      expect.objectContaining({ patientName: 'Paciente' })
    )
  })

  it('não deve lançar quando o push ou o broadcast falham (fire-and-forget)', async () => {
    setup()
    g.sendTranscriptionErrorPush = vi.fn(async () => {
      throw new Error('push indisponível')
    })

    await expect(
      notifyTranscriptionFailed({ id: 't-1', workspace_id: 'w-1', patient_id: 'p-1', recorded_by: 'u-1' })
    ).resolves.toBeUndefined()
  })
})
