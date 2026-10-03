import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import { matchesAppointmentPatient, PATIENT_MISMATCH_MESSAGE } from '@/lib/transcriptions/patient-identity'

// Finaliza uma transcrição depois que o browser já subiu o áudio direto pro
// Storage via a signed upload URL emitida por /api/transcriptions/upload-url
// (uploadToSignedUrl) — esta rota só recebe metadados (JSON pequeno), nunca
// o arquivo em si, então não esbarra no limite de corpo de funções
// serverless da Vercel mesmo para gravações longas.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'transcriptions')
  if (moduleCheck) return moduleCheck

  const body = await req.json()
  const audioPath = body.audio_path as string | undefined
  const appointmentId = (body.appointment_id as string | null) || null
  const patientId = typeof body.patient_id === 'string' ? body.patient_id.trim() || null : null
  const patientName = typeof body.patient_name === 'string' ? body.patient_name.trim() : ''
  const unitName = typeof body.unit_name === 'string' ? body.unit_name.trim() : ''
  const consentConfirmed = body.consent_confirmed === true
  const durationSeconds = Number(body.duration_seconds ?? 0)

  if (!audioPath) return NextResponse.json({ error: 'audio_path é obrigatório' }, { status: 400 })
  if (!audioPath.startsWith(`${session.workspaceId}/`)) {
    return NextResponse.json({ error: 'audio_path fora do workspace atual' }, { status: 403 })
  }
  if (!consentConfirmed) return NextResponse.json({ error: 'Consentimento do paciente é obrigatório' }, { status: 400 })
  if (!patientId && !patientName) return NextResponse.json({ error: 'patient_id é obrigatório' }, { status: 400 })

  if (!patientId && !unitName) {
    return NextResponse.json({ error: 'Informe a unidade' }, { status: 400 })
  }
  if (!patientId && appointmentId) {
    return NextResponse.json({ error: 'Selecione um paciente cadastrado para vincular uma consulta existente' }, { status: 400 })
  }

  const supabase = await createClient()
  if (patientId) {
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('id, full_name, phone')
      .eq('id', patientId)
      .eq('account_id', session.accountId)
      .single()
    if (patientError || !patient) return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })

    if (appointmentId) {
      const { data: appointment, error: appointmentError } = await supabase
        .from('appointments')
        .select('patient_id, patient_name, patient_phone')
        .eq('id', appointmentId)
        .eq('workspace_id', session.workspaceId)
        .single()
      if (appointmentError || !appointment) return NextResponse.json({ error: 'Consulta não encontrada' }, { status: 404 })
      if ((appointment.patient_id && appointment.patient_id !== patientId)
        || !matchesAppointmentPatient(patient, appointment)) {
        return NextResponse.json({ error: PATIENT_MISMATCH_MESSAGE }, { status: 409 })
      }
    }
  }

  const { data: transcription, error: insertError } = await supabase
    .from('transcriptions')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      appointment_id: appointmentId,
      patient_id: patientId,
      patient_name: patientId ? null : patientName,
      unit_name: patientId ? null : unitName,
      recorded_by: session.userId,
      audio_path: audioPath,
      duration_seconds: durationSeconds,
      consent_confirmed: true,
      source: 'system',
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !transcription) {
    return NextResponse.json({ error: 'Falha ao criar registro', detail: insertError?.message }, { status: 500 })
  }

  // Service role: trigger_transcription_* anexa o CRON_SECRET e não é
  // executável por authenticated (migration_revoke_secret_rpcs.sql).
  const { error: triggerError } = await createAdminClient().rpc('trigger_transcription_process', {
    p_transcription_id: transcription.id,
    p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
  })
  if (triggerError) {
    console.error('[transcriptions] trigger_transcription_process failed:', triggerError.message)
  }

  return NextResponse.json({ id: transcription.id, status: 'pending' }, { status: 201 })
}
