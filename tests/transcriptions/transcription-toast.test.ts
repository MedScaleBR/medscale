import { describe, it, expect } from 'vitest'
import { shouldShowTranscriptionErrorToast } from '@/lib/transcriptions/transcription-toast'

describe('shouldShowTranscriptionErrorToast — decide se o toast in-app aparece', () => {
  it('deve mostrar quando o usuário logado é quem gravou a consulta', () => {
    expect(
      shouldShowTranscriptionErrorToast({
        currentUserId: 'u-1',
        event: { transcriptionId: 't-1', recordedBy: 'u-1' },
      })
    ).toBe(true)
  })

  it('NÃO deve mostrar quando outro médico gravou a consulta', () => {
    expect(
      shouldShowTranscriptionErrorToast({
        currentUserId: 'u-2',
        event: { transcriptionId: 't-1', recordedBy: 'u-1' },
      })
    ).toBe(false)
  })
})
