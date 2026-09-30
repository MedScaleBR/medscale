import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { ensureWhatsAppTemplates, WHATSAPP_TEMPLATES } from '@/lib/meta/whatsapp-templates'

const ok = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })
const metaError = (message: string) => new Response(JSON.stringify({ error: { message, code: 100 } }), { status: 400 })

describe('ensureWhatsAppTemplates', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('cria os três templates num WABA vazio', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ data: [] })).mockResolvedValue(ok({ id: 't1', status: 'PENDING' }))

    const r = await ensureWhatsAppTemplates('waba-1', 'tok')

    expect(r.created).toEqual(['appointment_reminder_2', 'waitlist_slot_available', 'waitlist_slot_specific'])
    expect(r.failed).toEqual([])

    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(String(url)).toContain('/waba-1/message_templates')
    expect(init?.method).toBe('POST')
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('name')).toBe('appointment_reminder_2')
    expect(body.get('language')).toBe('pt_BR')
    expect(body.get('category')).toBe('UTILITY')
    const [component] = JSON.parse(body.get('components')!)
    expect(component.type).toBe('BODY')
    expect(component.example.body_text[0]).toHaveLength(4)
  })

  it('não recria o que já existe no WABA', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ data: [{ name: 'appointment_reminder_2', language: 'pt_BR' }] }))
      .mockResolvedValue(ok({ id: 't2' }))

    const r = await ensureWhatsAppTemplates('waba-1', 'tok')

    expect(r.existing).toEqual(['appointment_reminder_2'])
    expect(r.created).toEqual(['waitlist_slot_available', 'waitlist_slot_specific'])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('falha de um template não impede os outros', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ data: [] }))
      .mockResolvedValueOnce(metaError('Invalid parameter'))
      .mockResolvedValue(ok({ id: 't3' }))

    const r = await ensureWhatsAppTemplates('waba-1', 'tok')

    expect(r.failed).toEqual([{ name: 'appointment_reminder_2', error: 'Invalid parameter' }])
    expect(r.created).toEqual(['waitlist_slot_available', 'waitlist_slot_specific'])
  })

  it('sem conseguir listar, marca todos como falha e não tenta criar', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(metaError('Permissions error'))

    const r = await ensureWhatsAppTemplates('waba-1', 'tok')

    expect(r.failed).toHaveLength(3)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('cada template tem um exemplo por variável e o nome usado em send.ts', () => {
    const send = readFileSync('lib/whatsapp/send.ts', 'utf-8')
    for (const t of WHATSAPP_TEMPLATES) {
      const vars = t.body.match(/\{\{\d+\}\}/g) ?? []
      expect(t.example).toHaveLength(vars.length)
      expect(send).toContain(`'${t.name}'`)
    }
  })
})
