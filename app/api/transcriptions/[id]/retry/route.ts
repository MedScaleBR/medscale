import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

// Re-dispara o pipeline a partir do início após um `status = 'error'`. As
// rotas /api/transcriptions/process e /generate-record exigem CRON_SECRET e
// não podem ser chamadas direto pelo browser — esta rota autentica a sessão
// do usuário e delega para trigger_transcription_process via RPC.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'transcriptions')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()

  const { data: transcription } = await supabase
    .from('transcriptions')
    .select('id, status')
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .single()

  if (!transcription) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (transcription.status !== 'error') {
    return NextResponse.json({ error: 'Só é possível reprocessar transcrições com erro' }, { status: 409 })
  }

  const { error: updateError } = await supabase
    .from('transcriptions')
    .update({ status: 'pending', retry_count: 0, error_message: null })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { error: triggerError } = await supabase.rpc('trigger_transcription_process', {
    p_transcription_id: id,
    p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
  })
  if (triggerError) return NextResponse.json({ error: triggerError.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: 'pending' })
}
