import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

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
  const patientId = body.patient_id as string | undefined
  const consentConfirmed = body.consent_confirmed === true
  const durationSeconds = Number(body.duration_seconds ?? 0)

  if (!audioPath) return NextResponse.json({ error: 'audio_path é obrigatório' }, { status: 400 })
  if (!audioPath.startsWith(`${session.workspaceId}/`)) {
    return NextResponse.json({ error: 'audio_path fora do workspace atual' }, { status: 403 })
  }
  if (!consentConfirmed) return NextResponse.json({ error: 'Consentimento do paciente é obrigatório' }, { status: 400 })
  if (!patientId) return NextResponse.json({ error: 'patient_id é obrigatório' }, { status: 400 })

  const supabase = await createClient()

  const { data: transcription, error: insertError } = await supabase
    .from('transcriptions')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      appointment_id: appointmentId,
      patient_id: patientId,
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

  const { error: triggerError } = await supabase.rpc('trigger_transcription_process', {
    p_transcription_id: transcription.id,
    p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
  })
  if (triggerError) {
    console.error('[transcriptions] trigger_transcription_process failed:', triggerError.message)
  }

  return NextResponse.json({ id: transcription.id, status: 'pending' }, { status: 201 })
}
