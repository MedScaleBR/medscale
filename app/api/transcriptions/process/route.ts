import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { transcribeAudio } from '@/lib/transcriptions/whisper'

export const maxDuration = 60

// Disparado via pg_net por trigger_transcription_process (upload ou retry) —
// mesma autenticação Bearer CRON_SECRET das rotas em app/api/cron/*.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    const transcriptText = await transcribeAudio(signedData.signedUrl)

    await supabase
      .from('transcriptions')
      .update({ transcript_text: transcriptText, status: 'transcribed', retry_count: 0, error_message: null })
      .eq('id', transcription_id)

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
    }

    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
