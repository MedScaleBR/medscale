import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { broadcastToWorkspace } from '@/lib/realtime/broadcast'

describe('broadcastToWorkspace — emite Realtime Broadcast por workspace', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deve fazer POST no endpoint de broadcast do Realtime com o tópico da workspace', async () => {
    await broadcastToWorkspace('w-123', 'handoff_message', { conversationId: 'c-1', patientName: 'Ana' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test.supabase.co/realtime/v1/api/broadcast')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['apikey']).toBe('service-role-key-test')
    expect(headers['Authorization']).toBe('Bearer service-role-key-test')

    expect(JSON.parse(init.body as string)).toEqual({
      messages: [
        {
          topic: 'handoff-toast:w-123',
          event: 'handoff_message',
          payload: { conversationId: 'c-1', patientName: 'Ana' },
          private: false,
        },
      ],
    })
  })

  it('não deve lançar quando o fetch rejeita (fire-and-forget)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(
      broadcastToWorkspace('w-1', 'handoff_message', { conversationId: 'c-1', patientName: 'Ana' })
    ).resolves.toBeUndefined()
  })

  it('não deve lançar quando a resposta é não-ok', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(
      broadcastToWorkspace('w-1', 'handoff_message', { conversationId: 'c-1', patientName: 'Ana' })
    ).resolves.toBeUndefined()
  })
})
