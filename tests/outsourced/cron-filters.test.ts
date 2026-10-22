import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSupabaseMock, filterValue, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => g.supabase.client }))
vi.mock('@/lib/whatsapp/send', () => ({ sendReminderTemplate: vi.fn() }))
vi.mock('@/lib/crypto', () => ({ decryptToken: vi.fn() }))
vi.mock('@/lib/revenue/cycle', () => ({ syncRevenueEntryToAppointmentStatus: vi.fn() }))

import { POST as remindersPOST } from '@/app/api/cron/reminders/route'
import { POST as noshowPOST } from '@/app/api/cron/noshow/route'

function request(path: string) {
  return new Request(`https://app.test/api/cron/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret-test' },
  }) as never
}

// Regressão: consulta pendente_confirmacao_externa (aguardando a clínica
// parceira) nunca recebe lembrete nem vira no_show.
describe('crons de lembrete e no-show ignoram pendentes', () => {
  beforeEach(() => {
    g.supabase = createSupabaseMock({ appointments: { select: { data: [] } } })
  })

  it('reminders filtra exatamente agendado/confirmado', async () => {
    await remindersPOST(request('reminders'))
    const call = g.supabase.callsTo('appointments', 'select')[0]
    expect(filterValue(call, 'in', 'status')).toEqual(['agendado', 'confirmado'])
  })

  it('noshow filtra exatamente agendado/confirmado', async () => {
    await noshowPOST(request('noshow'))
    const call = g.supabase.callsTo('appointments', 'select')[0]
    expect(filterValue(call, 'in', 'status')).toEqual(['agendado', 'confirmado'])
  })
})
