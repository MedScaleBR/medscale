import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const h = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseMock,
  botConfig: { isActive: true, metaToken: 'enc' } as { isActive: boolean; metaToken: string | null } | null,
  units: [] as { id: string; botSettings: { intakeFields: string[] } }[],
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => h.supabase.client }))
vi.mock('@/lib/bot/config', () => ({ getBotConfig: async () => h.botConfig, getAccountUnits: async () => h.units }))
vi.mock('@/lib/crypto', () => ({ decryptToken: (t: string) => `decrypted:${t}` }))

import {
  downloadWhatsAppMedia,
  INSURANCE_CARD_MAX_BYTES,
  parseIncomingMedia,
  receiveInsuranceCard,
} from '@/lib/bot/insurance-card'
import { INSURANCE_CARD_RECEIVED_TEXT, INSURANCE_CARD_REJECTED_TEXT, missingIntakeFields } from '@/lib/bot/unit-settings'
import { parseNotificationEmails, splitEmails } from '@/lib/bot/notification-emails'

const CONVERSATION = { id: 'conv-1', workspace_id: 'w1' }

function fakeFetch(meta: Record<string, unknown>, fileBytes = 3, ok = true) {
  return vi.fn(async (url: string) => {
    if (url.includes('graph.facebook.com')) return new Response(JSON.stringify(meta), { status: ok ? 200 : 400 })
    return new Response(new Uint8Array(fileBytes), { status: 200 })
  }) as unknown as typeof fetch
}

const IMAGE = { type: 'image' as const, mediaId: 'm1', mimeType: 'image/jpeg', caption: null }

let logs: string[] = []

describe('foto da carteirinha', () => {
  beforeEach(() => {
    h.supabase = createSupabaseMock({
      conversations: { select: { data: CONVERSATION } },
      conversation_attachments: { insert: { data: null } },
    })
    h.botConfig = { isActive: true, metaToken: 'enc' }
    h.units = [{ id: 'w1', botSettings: { intakeFields: ['full_name', 'insurance', 'insurance_card_photo'] } }]
    logs = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
  })
  afterEach(() => vi.restoreAllMocks())

  it('parseIncomingMedia: só image e document', () => {
    expect(parseIncomingMedia({ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'frente' } })).toEqual({
      type: 'image',
      mediaId: 'm1',
      mimeType: 'image/jpeg',
      caption: 'frente',
    })
    expect(parseIncomingMedia({ type: 'document', document: { id: 'd1', mime_type: 'application/pdf' } })?.mediaId).toBe('d1')
    expect(parseIncomingMedia({ type: 'audio' })).toBeNull()
    expect(parseIncomingMedia({ type: 'sticker' })).toBeNull()
  })

  it('downloadWhatsAppMedia: recusa MIME fora da lista e arquivo acima de 10 MB', async () => {
    expect(await downloadWhatsAppMedia('m1', 't', fakeFetch({ url: 'https://cdn/x', mime_type: 'image/webp' }))).toEqual({
      ok: false,
      reason: 'mime',
    })
    expect(
      await downloadWhatsAppMedia('m1', 't', fakeFetch({ url: 'https://cdn/x', mime_type: 'image/png', file_size: INSURANCE_CARD_MAX_BYTES + 1 }))
    ).toEqual({ ok: false, reason: 'too_large' })
    const ok = await downloadWhatsAppMedia('m1', 't', fakeFetch({ url: 'https://cdn/x', mime_type: 'image/jpeg', file_size: 3 }))
    expect(ok).toMatchObject({ ok: true, mime: 'image/jpeg' })
  })

  it('salva no bucket privado, registra o anexo e devolve o texto de sistema com a legenda', async () => {
    const fetchImpl = fakeFetch({ url: 'https://cdn/x', mime_type: 'image/jpeg', file_size: 3 })
    const text = await receiveInsuranceCard({
      accountId: 'acc',
      patientPhone: '5571999990000',
      whatsappMessageId: 'wamid',
      media: { ...IMAGE, caption: 'segue a frente' },
      fetchImpl,
    })

    expect(text).toBe(`${INSURANCE_CARD_RECEIVED_TEXT}\nLegenda enviada junto: segue a frente`)
    expect(h.supabase.client.storage.from).toHaveBeenCalledWith('insurance-cards')
    const [path, , opts] = h.supabase.storage.upload.mock.calls[0] as unknown as [string, ArrayBuffer, { contentType: string }]
    expect(path).toMatch(/^acc\/conv-1\/\d+\.jpg$/)
    expect(opts.contentType).toBe('image/jpeg')
    expect(h.supabase.callsTo('conversation_attachments', 'insert')[0].payload).toMatchObject({
      account_id: 'acc',
      workspace_id: 'w1',
      conversation_id: 'conv-1',
      kind: 'insurance_card',
      mime_type: 'image/jpeg',
      size_bytes: 3,
      whatsapp_media_id: 'm1',
    })
    // Token da account no download; log sem telefone.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer decrypted:enc' } })
    expect(logs.join('\n')).not.toContain('5571999990000')
  })

  it('unidade sem insurance_card_photo: devolve null (comportamento atual)', async () => {
    h.units = [{ id: 'w1', botSettings: { intakeFields: ['full_name', 'insurance'] } }]
    expect(await receiveInsuranceCard({ accountId: 'acc', patientPhone: 'p', whatsappMessageId: 'x', media: IMAGE })).toBeNull()
    expect(h.supabase.storage.upload).not.toHaveBeenCalled()
  })

  it('conversa sem unidade numa account com várias: devolve null', async () => {
    h.units = [
      { id: 'w1', botSettings: { intakeFields: ['insurance_card_photo'] } },
      { id: 'w2', botSettings: { intakeFields: ['insurance_card_photo'] } },
    ]
    h.supabase = createSupabaseMock({ conversations: { select: { data: { id: 'conv-1', workspace_id: null } } } })
    expect(await receiveInsuranceCard({ accountId: 'acc', patientPhone: 'p', whatsappMessageId: 'x', media: IMAGE })).toBeNull()
  })

  it('documento de outro tipo ou falha no download: a Clara pede outra foto, nada é salvo', async () => {
    const doc = await receiveInsuranceCard({
      accountId: 'acc',
      patientPhone: 'p',
      whatsappMessageId: 'x',
      media: { type: 'document', mediaId: 'd1', mimeType: 'application/msword', caption: null },
    })
    expect(doc).toBe(INSURANCE_CARD_REJECTED_TEXT)

    const failed = await receiveInsuranceCard({
      accountId: 'acc',
      patientPhone: 'p',
      whatsappMessageId: 'x',
      media: IMAGE,
      fetchImpl: fakeFetch({}, 0, false),
    })
    expect(failed).toBe(INSURANCE_CARD_REJECTED_TEXT)
    expect(h.supabase.storage.upload).not.toHaveBeenCalled()
    expect(logs).toContainEqual('[insurance-card] rejected reason=download_failed conversation=conv-1')
  })

  it('registro falhou: remove o arquivo do Storage', async () => {
    h.supabase = createSupabaseMock({
      conversations: { select: { data: CONVERSATION } },
      conversation_attachments: { insert: { data: null, error: { message: 'x' } } },
    })
    const text = await receiveInsuranceCard({
      accountId: 'acc',
      patientPhone: 'p',
      whatsappMessageId: 'x',
      media: IMAGE,
      fetchImpl: fakeFetch({ url: 'https://cdn/x', mime_type: 'image/jpeg' }),
    })
    expect(text).toBe(INSURANCE_CARD_REJECTED_TEXT)
    expect(h.supabase.storage.remove).toHaveBeenCalledTimes(1)
  })

  it('a foto nunca bloqueia a solicitação', () => {
    expect(
      missingIntakeFields(['full_name', 'insurance', 'insurance_card_photo'], {
        fullName: 'Ana Souza',
        birthDate: null,
        insuranceResolved: true,
        particular: false,
        cardNumber: '123',
        cpf: null,
        email: null,
        reason: null,
        preference: null,
      })
    ).toEqual([])
  })
})

describe('e-mails da unidade', () => {
  it('valida formato, limite de 5 e remove repetidos', () => {
    expect(parseNotificationEmails(['A@b.com', 'a@b.com', ' c@d.com.br '])).toEqual({ ok: true, value: ['a@b.com', 'c@d.com.br'] })
    expect(parseNotificationEmails(['nao-e-email'])).toMatchObject({ ok: false })
    expect(parseNotificationEmails(['1@a.com', '2@a.com', '3@a.com', '4@a.com', '5@a.com', '6@a.com'])).toMatchObject({ ok: false })
    expect(parseNotificationEmails('a@b.com')).toMatchObject({ ok: false })
    expect(parseNotificationEmails([])).toEqual({ ok: true, value: [] })
  })

  it('splitEmails aceita linha, vírgula e ponto e vírgula', () => {
    expect(splitEmails('a@b.com\nc@d.com, e@f.com; ')).toEqual(['a@b.com', 'c@d.com', 'e@f.com'])
  })
})
