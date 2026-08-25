import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

// Arquiva/desarquiva uma transcrição (soft — o registro e o áudio continuam
// no banco, só somem da lista principal). Ver components/transcriptions/
// TranscriptionsListClient.tsx e TranscriptionDetailClient.tsx.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'transcriptions')
  if (moduleCheck) return moduleCheck

  const body = await req.json().catch(() => ({}))
  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'Campo "archived" (boolean) é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('transcriptions')
    .update({ archived_at: body.archived ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select('id, archived_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  return NextResponse.json(data)
}
