import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'

const RETENTION_DAYS = Number(process.env.RECORDING_RETENTION_DAYS ?? 90)

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql), 3h da manhã.
// Apaga do Storage os áudios de transcrições assinadas há mais de
// RECORDING_RETENTION_DAYS dias — mantém o transcript_text e o prontuário.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)

  const { data: oldTranscriptions } = await supabase
    .from('transcriptions')
    .select('id, audio_path')
    .eq('status', 'signed')
    .lt('signed_at', cutoffDate.toISOString())
    .not('audio_path', 'is', null)
    .neq('audio_path', '[deleted]')
    .limit(100)

  if (!oldTranscriptions?.length) return NextResponse.json({ deleted: 0 })

  const paths = oldTranscriptions.map((t) => t.audio_path)

  const { error: storageError } = await supabase.storage.from('recordings').remove(paths)

  if (storageError) {
    console.error('[cleanup-recordings] Storage delete error:', storageError)
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  const ids = oldTranscriptions.map((t) => t.id)
  await supabase.from('transcriptions').update({ audio_path: '[deleted]' }).in('id', ids)

  return NextResponse.json({ deleted: paths.length })
}
