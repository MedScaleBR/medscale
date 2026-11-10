import { describe, expect, it } from 'vitest'
import {
  appointmentDedupKey,
  buildLeadSubmittedPayload,
  externalRequestDedupKey,
  pickClickId,
} from '@/lib/meta/conversions'

const row = (ctwa_clid: string | null, occurred_at: string, patient_phone = '5561995704956') => ({
  patient_phone,
  ctwa_clid,
  occurred_at,
})

describe('pickClickId', () => {
  it('pega o clique mais recente anterior ao agendamento', () => {
    const rows = [
      row('A', '2026-11-01T12:00:00Z'),
      row('C', '2026-11-10T12:00:00Z'),
      row('B', '2026-11-05T12:00:00Z'),
    ]
    expect(pickClickId(rows, '5561995704956', new Date('2026-11-06T12:00:00Z'))).toBe('B')
  })

  it('casa telefone com máscara e sem nono dígito', () => {
    const rows = [row('A', '2026-11-01T12:00:00Z')]
    expect(pickClickId(rows, '(61) 9570-4956', new Date('2026-11-06T12:00:00Z'))).toBe('A')
  })

  it('ignora ctwa_clid nulo e telefone de outro paciente', () => {
    const rows = [row(null, '2026-11-01T12:00:00Z'), row('X', '2026-11-01T12:00:00Z', '5511988887777')]
    expect(pickClickId(rows, '5561995704956', new Date('2026-11-06T12:00:00Z'))).toBeNull()
  })
})

describe('buildLeadSubmittedPayload', () => {
  it('monta o evento sem valor', () => {
    expect(
      buildLeadSubmittedPayload({
        dedupKey: 'appt:1',
        eventTime: new Date(1731160000_000),
        wabaId: 'W',
        ctwaClid: 'C',
      })
    ).toEqual({
      data: [
        {
          event_name: 'LeadSubmitted',
          event_time: 1731160000,
          event_id: 'appt:1',
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: { whatsapp_business_account_id: 'W', ctwa_clid: 'C' },
        },
      ],
      partner_agent: 'medscale',
    })
  })
})

describe('dedup keys', () => {
  it('externalRequestDedupKey usa o dia de São Paulo', () => {
    expect(externalRequestDedupKey('c1', new Date('2026-11-10T02:30:00Z'))).toBe('ext:c1:2026-11-09')
  })

  it('appointmentDedupKey prefixa appt:', () => {
    expect(appointmentDedupKey('1')).toBe('appt:1')
  })
})

// ---------------------------------------------------------------------------
// Enfileirar e enviar
// ---------------------------------------------------------------------------
import { vi, beforeEach } from 'vitest'
import { createSupabaseMock, filterValue } from '../helpers/supabase-mock'
import { MetaApiError } from '@/lib/meta/graph'
import { queueLeadConversion, sendConversionEvent } from '@/lib/meta/conversions'

const graphFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/meta/graph', async (orig) => ({
  ...(await orig<typeof import('@/lib/meta/graph')>()),
  graphFetch,
}))
vi.mock('@/lib/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))

const EVENT = {
  id: 'e1',
  account_id: 'acc1',
  dedup_key: 'appt:1',
  ctwa_clid: 'C',
  event_time: '2026-11-09T12:00:00Z',
  attempts: 0,
}
const CONNECTED = { waba_id: 'W', meta_token: 'tok', meta_dataset_id: 'D' }

function mockDb(overrides: Record<string, unknown> = {}) {
  return createSupabaseMock({
    lead_attributions: { select: { data: [row('C', '2026-11-01T12:00:00Z')], error: null } },
    meta_conversion_events: {
      upsert: { data: [{ id: 'e1' }], error: null },
      select: { data: EVENT, error: null },
      update: { data: null, error: null },
    },
    bot_config: { select: { data: CONNECTED, error: null }, update: { data: null, error: null } },
    ...overrides,
  } as never)
}

describe('queueLeadConversion', () => {
  beforeEach(() => {
    graphFetch.mockReset()
    graphFetch.mockResolvedValue({ events_received: 1 })
  })

  const input = {
    accountId: 'acc1',
    patientPhone: '5561995704956',
    dedupKey: 'appt:1',
    appointmentId: '1',
    occurredAt: new Date('2026-11-09T12:00:00Z'),
  }

  it('não grava nada quando o paciente não tem ctwa_clid', async () => {
    const db = mockDb({ lead_attributions: { select: { data: [], error: null } } })
    await queueLeadConversion(input, db.client as never)
    expect(db.callsTo('meta_conversion_events', 'upsert')).toHaveLength(0)
    expect(graphFetch).not.toHaveBeenCalled()
  })

  it('grava e envia quando há clique', async () => {
    const db = mockDb()
    await queueLeadConversion(input, db.client as never)
    const [up] = db.callsTo('meta_conversion_events', 'upsert')
    expect(up.payload).toEqual(
      expect.objectContaining({ account_id: 'acc1', dedup_key: 'appt:1', ctwa_clid: 'C', appointment_id: '1' })
    )
    expect(up.options).toEqual({ onConflict: 'account_id,dedup_key', ignoreDuplicates: true })
    expect(graphFetch).toHaveBeenCalledWith('/D/events', expect.objectContaining({ method: 'POST', token: 'dec:tok' }))
    const [upd] = db.callsTo('meta_conversion_events', 'update')
    expect(upd.payload).toEqual(expect.objectContaining({ status: 'sent', attempts: 1 }))
  })

  it('mesmo dedup_key não reenvia', async () => {
    const db = mockDb({
      meta_conversion_events: { upsert: { data: [], error: null } },
    })
    await queueLeadConversion(input, db.client as never)
    expect(graphFetch).not.toHaveBeenCalled()
  })

  it('erro da Meta marca failed com código e não lança', async () => {
    graphFetch.mockRejectedValue(new MetaApiError('no perm', 200, null, 403))
    const db = mockDb()
    await expect(queueLeadConversion(input, db.client as never)).resolves.toBeUndefined()
    const [upd] = db.callsTo('meta_conversion_events', 'update')
    expect(upd.payload).toEqual(expect.objectContaining({ status: 'failed', attempts: 1 }))
    expect((upd.payload as { last_error: string }).last_error.startsWith('200:')).toBe(true)
  })

  it('Meta que não responde não segura o agendamento: desiste em 5s e marca failed', async () => {
    vi.useFakeTimers()
    try {
      graphFetch.mockImplementation(() => new Promise(() => {}))
      const db = mockDb()
      const done = queueLeadConversion(input, db.client as never)
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(done).resolves.toBeUndefined()
      const [upd] = db.callsTo('meta_conversion_events', 'update')
      expect(upd.payload).toEqual(expect.objectContaining({ status: 'failed', last_error: 'timeout' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('não lança quando o banco explode', async () => {
    const db = mockDb({ lead_attributions: { select: () => { throw new Error('boom') } } })
    await expect(queueLeadConversion(input, db.client as never)).resolves.toBeUndefined()
  })
})

describe('sendConversionEvent', () => {
  beforeEach(() => {
    graphFetch.mockReset()
  })

  it('cria o dataset uma vez e guarda em bot_config', async () => {
    graphFetch.mockResolvedValueOnce({ id: 'D2' }).mockResolvedValueOnce({ events_received: 1 })
    const db = mockDb({
      bot_config: {
        select: { data: { ...CONNECTED, meta_dataset_id: null }, error: null },
        update: { data: null, error: null },
      },
    })
    expect(await sendConversionEvent('e1', db.client as never)).toBe('sent')
    expect(graphFetch).toHaveBeenNthCalledWith(1, '/W/dataset', expect.objectContaining({ method: 'POST' }))
    expect(graphFetch).toHaveBeenNthCalledWith(2, '/D2/events', expect.anything())
    const [upd] = db.callsTo('bot_config', 'update')
    expect(upd.payload).toEqual({ meta_dataset_id: 'D2' })
    expect(filterValue(upd, 'eq', 'account_id')).toBe('acc1')
  })

  it('account sem WhatsApp conectado marca failed not_connected', async () => {
    const db = mockDb({
      bot_config: { select: { data: { waba_id: null, meta_token: null, meta_dataset_id: null }, error: null } },
    })
    expect(await sendConversionEvent('e1', db.client as never)).toBe('failed')
    expect(graphFetch).not.toHaveBeenCalled()
    const [upd] = db.callsTo('meta_conversion_events', 'update')
    expect(upd.payload).toEqual(expect.objectContaining({ status: 'failed', last_error: 'not_connected' }))
  })
})
