import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => g.supabase.client,
  createAdminClient: () => g.supabase.client,
}))
vi.mock('@/lib/session/api', () => ({
  requireWorkspaceSession: async () => ({ session: { accountId: 'acc1', workspaceId: 'w1', userId: 'u1' } }),
  requireModule: () => null,
}))
import { POST as resolvePatient } from '@/app/api/patients/find-or-create/route'
import { POST as createTranscription } from '@/app/api/transcriptions/route'

const patient = { id: 'p1', full_name: 'Maria Silva', phone: '5511999990000' }
const appointment = { id: 'a1', patient_id: null, patient_name: 'Maria Silva', patient_phone: patient.phone }
const request = (path: string, body: object) => new NextRequest(`http://localhost${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  g.supabase = createSupabaseMock({
    appointments: { select: { data: appointment } },
    patients: { select: { data: patient }, insert: { data: patient } },
    transcriptions: { insert: { data: { id: 't1' } } },
  })
})

describe('patient resolution for calendar recordings', () => {
  it('refuses a different patient sharing the appointment phone', async () => {
    g.supabase = createSupabaseMock({ patients: { select: { data: { ...patient, full_name: 'Joao Souza' } } } })
    const response = await resolvePatient(request('/api/patients/find-or-create', {
      full_name: 'Maria Silva', phone: patient.phone,
    }))
    expect(response.status).toBe(409)
    expect(g.supabase.callsTo('patients', 'insert')).toHaveLength(0)
  })
  it('uses the saved appointment instead of stale client patient details', async () => {
    const response = await resolvePatient(request('/api/patients/find-or-create', {
      appointment_id: 'a1', full_name: 'Joao Souza', phone: '5511888880000',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'p1', full_name: 'Maria Silva' })
    expect(g.supabase.callsTo('patients', 'select')[0].filters).toContainEqual(['eq', 'phone', patient.phone])
    expect(g.supabase.callsTo('appointments', 'select')[0].filters).toContainEqual(['eq', 'workspace_id', 'w1'])
  })
  it('refuses a stale linked patient with a different name', async () => {
    g.supabase = createSupabaseMock({
      appointments: { select: { data: { ...appointment, patient_id: 'p2' } } },
      patients: { select: { data: { ...patient, id: 'p2', full_name: 'Joao Souza' } } },
    })
    const response = await resolvePatient(request('/api/patients/find-or-create', { appointment_id: 'a1' }))
    expect(response.status).toBe(409)
  })
  it('does not create a patient when the lookup fails', async () => {
    g.supabase = createSupabaseMock({ patients: { select: { error: { message: 'database unavailable' } }, insert: { data: patient } } })
    const response = await resolvePatient(request('/api/patients/find-or-create', { full_name: patient.full_name, phone: patient.phone }))
    expect(response.status).toBe(500)
    expect(g.supabase.callsTo('patients', 'insert')).toHaveLength(0)
  })
  it('accepts formatting differences for the same patient', async () => {
    const response = await resolvePatient(request('/api/patients/find-or-create', { full_name: '  MARIA   SILVA ', phone: '(11) 99999-0000' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'p1' })
    expect(g.supabase.callsTo('patients', 'select')[0].filters).toContainEqual(['eq', 'phone', patient.phone])
  })
})

describe('finalizing a calendar recording', () => {
  const body = { audio_path: 'w1/a1/audio.webm', appointment_id: 'a1', patient_id: 'p1', consent_confirmed: true, duration_seconds: 60 }
  it('rejects a patient that does not match the saved appointment', async () => {
    g.supabase = createSupabaseMock({
      appointments: { select: { data: appointment } },
      patients: { select: { data: { ...patient, full_name: 'Joao Souza' } } },
      transcriptions: { insert: { data: { id: 't1' } } },
    })
    const response = await createTranscription(request('/api/transcriptions', body))
    expect(response.status).toBe(409)
    expect(g.supabase.callsTo('transcriptions', 'insert')).toHaveLength(0)
  })
  it('records the matching patient and triggers processing', async () => {
    const response = await createTranscription(request('/api/transcriptions', body))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: 't1' })
    expect(g.supabase.callsTo('transcriptions', 'insert')[0].payload).toMatchObject({ patient_id: 'p1', appointment_id: 'a1' })
  })
  it('rejects an appointment outside the active workspace', async () => {
    g.supabase = createSupabaseMock({ appointments: { select: { data: null } }, patients: { select: { data: patient } }, transcriptions: { insert: { data: { id: 't1' } } } })
    const response = await createTranscription(request('/api/transcriptions', body))
    expect(response.status).toBe(404)
    expect(g.supabase.callsTo('transcriptions', 'insert')).toHaveLength(0)
  })
})
