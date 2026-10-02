import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const denied = requireRole(session, ['owner', 'admin'])
  if (denied) return denied
  const global = req.nextUrl.searchParams.get('scope') === 'global'
  const supabase = await createClient()
  const query = global
    ? supabase.from('account_handoff_hours').delete().eq('account_id', session.accountId)
    : supabase.from('handoff_hours').delete().eq('workspace_id', session.workspaceId)
  const { error } = await query.eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
