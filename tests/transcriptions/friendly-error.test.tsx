import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TranscriptionDetailClient } from '@/components/transcriptions/TranscriptionDetailClient'
import type { Transcription } from '@/lib/transcriptions/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/session/session-context', () => ({ useAnalyticsBase: () => ({}) }))

it('shows a helpful retry message for an existing transcription with a stored SOAP validation error', () => {
  const initial = {
    id: 't1', status: 'error', archived_at: null, medical_record_draft: null,
    error_message: 'Error: Claude returned an invalid SOAP record: SOAPValidationError: soap.S.queixa_principal é obrigatório e deve ser uma string não vazia',
  } as Transcription
  const html = renderToStaticMarkup(<TranscriptionDetailClient initial={initial} />)
  expect(html).toContain('Não foi possível gerar o prontuário desta consulta.')
  expect(html).toContain('Tentar novamente')
  expect(html).not.toContain('Claude')
  expect(html).not.toContain('SOAPValidationError')
  expect(html).not.toContain('soap.S.queixa_principal')
})
