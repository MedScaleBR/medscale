import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { normalizeBrazilianPhone } from '@/lib/phone'
import { matchesAppointmentPatient, PATIENT_MISMATCH_MESSAGE } from '@/lib/transcriptions/patient-identity'

// Resolve o paciente pelo telefone (unique por account) ou cria um novo —
// usado ao iniciar uma transcrição a partir de uma consulta da Agenda, já
// que appointments guarda patient_name/patient_phone em texto livre e nem
// sempre tem patient_id vinculado.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  let fullName = body.full_name as string | undefined
  let phone = body.phone as string | undefined
  let linkedPatientId: string | null = null
  const supabase = await createClient()

  if (body.appointment_id) {
    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('patient_id, patient_name, patient_phone')
      .eq('id', body.appointment_id)
      .eq('workspace_id', session.workspaceId)
      .single()
    if (error || !appointment) return NextResponse.json({ error: 'Consulta não encontrada' }, { status: 404 })
    fullName = appointment.patient_name
    phone = appointment.patient_phone
    linkedPatientId = appointment.patient_id
  }

  phone = normalizeBrazilianPhone(phone) ?? undefined
  if (!fullName || !phone) {
    return NextResponse.json({ error: 'full_name e phone são obrigatórios' }, { status: 400 })
  }

  let query = supabase
    .from('patients')
    .select('id, full_name, phone')
    .eq('account_id', session.accountId)
  query = linkedPatientId ? query.eq('id', linkedPatientId) : query.eq('phone', phone)
  const { data: existing, error: lookupError } = await query.maybeSingle()
  if (lookupError) return NextResponse.json({ error: 'Falha ao buscar paciente' }, { status: 500 })

  if (existing) {
    if (!matchesAppointmentPatient(existing, { patient_name: fullName, patient_phone: phone })) {
      return NextResponse.json({ error: PATIENT_MISMATCH_MESSAGE }, { status: 409 })
    }
    return NextResponse.json({ id: existing.id, full_name: existing.full_name })
  }
  if (linkedPatientId) return NextResponse.json({ error: PATIENT_MISMATCH_MESSAGE }, { status: 409 })

  const { data: created, error } = await supabase
    .from('patients')
    .insert({
      account_id: session.accountId,
      full_name: fullName,
      phone,
      created_by: session.userId,
    })
    .select('id, full_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(created, { status: 201 })
}
