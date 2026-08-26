import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Restrito ao owner da account' }, { status: 403 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('invites').delete().eq('id', id).eq('account_id', session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
