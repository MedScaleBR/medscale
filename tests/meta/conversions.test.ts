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
