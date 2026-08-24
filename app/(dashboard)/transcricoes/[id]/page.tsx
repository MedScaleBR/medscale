import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { TranscriptionDetailClient } from '@/components/transcriptions/TranscriptionDetailClient'
import { TranscriptionStatusBadge } from '@/components/transcriptions/TranscriptionStatusBadge'
import { AudioPlayer } from '@/components/transcriptions/AudioPlayer'
import type { Transcription } from '@/lib/transcriptions/types'

export default async function TranscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: transcription } = await supabase
    .from('transcriptions')
    .select('*, patient:patients(full_name)')
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .single()

  if (!transcription) notFound()

  const { patient, ...row } = transcription as typeof transcription & { patient: { full_name: string } | null }

  const hasAudio = row.audio_path && row.audio_path !== '[deleted]'
  const { data: signedAudio } = hasAudio
    ? await supabase.storage.from('recordings').createSignedUrl(row.audio_path, 3600)
    : { data: null }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/transcricoes" className="text-xs text-gray-400 hover:text-[var(--cyan-dark)]">
            ← Transcrições
          </Link>
          <h1 className="mt-1 text-xl font-medium text-gray-900">{patient?.full_name ?? 'Paciente'}</h1>
          <p className="text-sm text-gray-400">
            {new Date(row.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        </div>
        <TranscriptionStatusBadge status={row.status} />
      </div>

      <AudioPlayer audioUrl={signedAudio?.signedUrl ?? null} />

      <TranscriptionDetailClient initial={row as unknown as Transcription} />
    </div>
  )
}
