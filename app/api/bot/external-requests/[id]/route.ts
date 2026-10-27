import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { EXTERNAL_REQUEST_REASON } from '@/lib/bot/external-request'

// Marca uma solicitação de agendamento (unidade com agenda externa) como
// tratada pela equipe. Quem vê a conversa pode marcar: a RLS de handoff_logs
// já limita às unidades do usuário.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json().catch(() => ({}))
  if (typeof body?.resolved !== 'boolean') {
    return NextResponse.json({ error: 'resolved é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('handoff_logs')
    .update(
      body.resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: session.userId }
        : { resolved_at: null, resolved_by: null }
    )
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .eq('trigger_reason', EXTERNAL_REQUEST_REASON)
    .select('id, resolved_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Não foi possível atualizar a solicitação.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 })
  return NextResponse.json(data)
}
