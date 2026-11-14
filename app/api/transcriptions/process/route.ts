import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { pickConsultationModel, transcribeAudio } from '@/lib/transcriptions/whisper'
import { trackTranscriptionCompleted, trackTranscriptionError } from '@/lib/analytics/posthog-server'
import { notifyTranscriptionFailed } from '@/lib/transcriptions/notify-error'
import { recordWhisperCost } from '@/lib/costs/record'

// O Whisper leva mais que 60s numa consulta de ~9 min. Se a Vercel corta a
// função no meio, o catch não roda e a linha fica presa em 'transcribing' —
// quem destrava é app/api/cron/stuck-transcriptions.
export const maxDuration = 300

// Disparado via pg_net por trigger_transcription_process (upload ou retry) —
// mesma autenticação Bearer CRON_SECRET das rotas em app/api/cron/*.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const { transcription_id } = await req.json()
  const supabase = createAdminClient()

  const { data: transcription } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('id', transcription_id)
    .single()

  if (!transcription) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (transcription.status === 'signed') return NextResponse.json({ ok: true })

  await supabase.from('transcriptions').update({ status: 'transcribing' }).eq('id', transcription_id)

  try {
    const { data: signedData } = await supabase.storage
      .from('recordings')
      .createSignedUrl(transcription.audio_path, 3600)

    if (!signedData?.signedUrl) throw new Error('Could not generate signed URL')

    const model = pickConsultationModel(transcription.duration_seconds)
    const transcriptText = await transcribeAudio(signedData.signedUrl, model)

    await supabase
      .from('transcriptions')
      .update({ transcript_text: transcriptText, status: 'transcribed', retry_count: 0, error_message: null })
      .eq('id', transcription_id)

    // O Whisper cobra por duração, então o custo só é conhecido aqui, depois
    // de transcrever. Uma tentativa que falhou não gera linha: a OpenAI não
    // cobra pelo áudio que não voltou transcrito.
    await recordWhisperCost({
      ctx: { accountId: transcription.account_id, workspaceId: transcription.workspace_id },
      durationSeconds: transcription.duration_seconds ?? 0,
      transcriptionId: transcription_id,
      source: 'consulta',
      model,
    })

    await trackTranscriptionCompleted(transcription.recorded_by, {
      workspace_id: transcription.workspace_id,
      account_id: transcription.account_id,
      duration_seconds: transcription.duration_seconds ?? 0,
    })

    const { error: triggerError } = await supabase.rpc('trigger_transcription_generate', {
      p_transcription_id: transcription_id,
      p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
    })
    if (triggerError) console.error('[transcriptions/process] trigger_transcription_generate failed:', triggerError.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const retryCount = (transcription.retry_count ?? 0) + 1

    if (retryCount < 3) {
      await supabase
        .from('transcriptions')
        .update({ status: 'pending', retry_count: retryCount, error_message: String(err) })
        .eq('id', transcription_id)

      const { error: triggerError } = await supabase.rpc('trigger_transcription_process', {
        p_transcription_id: transcription_id,
        p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
      })
      if (triggerError) console.error('[transcriptions/process] retry trigger failed:', triggerError.message)
    } else {
      await supabase
        .from('transcriptions')
        .update({ status: 'error', error_message: String(err) })
        .eq('id', transcription_id)

      await trackTranscriptionError(transcription.recorded_by, {
        workspace_id: transcription.workspace_id,
        account_id: transcription.account_id,
        error_message: String(err),
        retry_count: retryCount,
      })

      await notifyTranscriptionFailed({
        id: transcription.id,
        workspace_id: transcription.workspace_id,
        patient_id: transcription.patient_id,
        patient_name: transcription.patient_name,
        recorded_by: transcription.recorded_by,
      })
    }

    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
