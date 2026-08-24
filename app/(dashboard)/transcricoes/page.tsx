import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { TranscriptionsListClient } from '@/components/transcriptions/TranscriptionsListClient'

export default async function TranscricoesPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: transcriptionsRaw } = await supabase
    .from('transcriptions')
    .select('id, status, created_at, duration_seconds, recorded_by, patient:patients(full_name)')
    .eq('workspace_id', session.workspaceId)
    .order('created_at', { ascending: false })
    .limit(200)

  const transcriptions = transcriptionsRaw ?? []

  // profiles não tem FK direta com transcriptions.recorded_by (ambos
  // referenciam auth.users independentemente) — busca separada, mesmo padrão
  // de app/(admin)/admin/accounts/[id]/page.tsx.
  const doctorIds = [...new Set(transcriptions.map((t) => t.recorded_by))]
  const { data: doctorsRaw } =
    doctorIds.length > 0 ? await supabase.from('profiles').select('id, full_name').in('id', doctorIds) : { data: [] }
  const doctorNameById = new Map((doctorsRaw ?? []).map((d) => [d.id, d.full_name]))

  const rows = transcriptions.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.created_at,
    durationSeconds: t.duration_seconds,
    patientName: (t.patient as unknown as { full_name: string } | null)?.full_name ?? '—',
    doctorName: doctorNameById.get(t.recorded_by) ?? '—',
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Transcrições</h1>
        <p className="text-sm text-gray-400">{rows.length} transcrições registradas</p>
      </div>
      <TranscriptionsListClient rows={rows} />
    </div>
  )
}
