import { describe, it, expect } from 'vitest'
import { partitionWaitlist, formatBotSlot, type WaitlistRow } from '@/lib/waitlist/match'

const row = (over: Partial<WaitlistRow>): WaitlistRow => ({
  id: 'x',
  workspace_id: 'w1',
  account_id: 'a1',
  patient_name: 'Ana',
  patient_phone: '551199',
  notified_at: null,
  desired_date: null,
  desired_time: null,
  source: 'manual',
  ...over,
})

describe('partitionWaitlist', () => {
  it('manda source bot com desired_date para "bot" e o resto para "manual"', () => {
    const rows = [
      row({ id: 'a', source: 'bot', desired_date: '2026-09-16' }),
      row({ id: 'b', source: 'bot', desired_date: null }), // bot sem data → manual
      row({ id: 'c', source: 'manual', desired_date: '2026-09-16' }), // manual com data → manual
      row({ id: 'd', source: 'manual' }),
    ]
    const { bot, manual } = partitionWaitlist(rows)
    expect(bot.map((r) => r.id)).toEqual(['a'])
    expect(manual.map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })
})

describe('formatBotSlot', () => {
  it('nomeia o horário exato quando o paciente pediu um', () => {
    // 2026-09-16 é uma quarta-feira
    expect(formatBotSlot('2026-09-16', '15:00', [])).toBe('quarta-feira, 16/09 às 15:00')
  })

  it('lista os horários livres do dia quando o paciente pediu só o dia', () => {
    expect(formatBotSlot('2026-09-16', null, ['14:00', '15:30', '16:00'])).toBe(
      'quarta-feira, 16/09 — 14:00, 15:30, 16:00'
    )
  })

  it('corta o segundo do desired_time (HH:mm:ss → HH:mm)', () => {
    expect(formatBotSlot('2026-09-16', '15:00:00', [])).toBe('quarta-feira, 16/09 às 15:00')
  })
})
