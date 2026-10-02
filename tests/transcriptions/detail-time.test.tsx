import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSupabaseMock } from '../helpers/supabase-mock'

vi.mock('@/lib/session/server', () => ({ resolveActiveSession: async () => ({ workspaceId: 'w1' }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => createSupabaseMock({
  transcriptions: { select: { data: {
    id: 't1', created_at: '2026-10-01T20:01:00Z', patient: { full_name: 'Maria Silva' }, status: 'pending', audio_path: null,
  } } },
}).client }))
vi.mock('@/components/transcriptions/TranscriptionDetailClient', () => ({ TranscriptionDetailClient: () => null }))
vi.mock('@/components/transcriptions/AudioPlayer', () => ({ AudioPlayer: () => null }))
import Page from '@/app/(dashboard)/transcricoes/[id]/page'

it('shows a 20:01 UTC recording at 17:01 in Sao Paulo, independent of server timezone', async () => {
  const previous = process.env.TZ
  process.env.TZ = 'UTC'
  try {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 't1' }) }))
    expect(html).toContain('17:01')
    expect(html).not.toContain('20:01')
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
