import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { generateSOAP } from '@/lib/transcriptions/generate-soap'
import { trackSoapGenerated, trackTranscriptionError } from '@/lib/analytics/posthog-server'

export const maxDuration = 60

// Disparado via pg_net por trigger_transcription_generate — mesma
// autenticação Bearer CRON_SECRET das rotas em app/api/cron/*.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { transcription_id } = await req.json()
  const supabase = createAdminClient()

  const { data: transcription } = await supabase
    .from('transcriptions')
    .select('transcript_text, retry_count, workspace_id, account_id, recorded_by')
    .eq('id', transcription_id)
    .single()

  if (!transcription?.transcript_text) {
    return NextResponse.json({ error: 'No transcript text' }, { status: 400 })
  }

  await supabase.from('transcriptions').update({ status: 'generating' }).eq('id', transcription_id)

  try {
    const soapRecord = await generateSOAP(transcription.transcript_text)

    await supabase
      .from('transcriptions')
      .update({
        medical_record_draft: soapRecord,
        status: 'draft_ready',
        retry_count: 0,
        error_message: null,
      })
      .eq('id', transcription_id)

    await trackSoapGenerated(transcription.recorded_by, {
      workspace_id: transcription.workspace_id,
      account_id: transcription.account_id,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const retryCount = (transcription.retry_count ?? 0) + 1

    if (retryCount < 3) {
      await supabase
        .from('transcriptions')
        .update({ status: 'transcribed', retry_count: retryCount, error_message: String(err) })
        .eq('id', transcription_id)

      const { error: triggerError } = await supabase.rpc('trigger_transcription_generate', {
        p_transcription_id: transcription_id,
        p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
      })
      if (triggerError) console.error('[transcriptions/generate-record] retry trigger failed:', triggerError.message)
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
    }

    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
