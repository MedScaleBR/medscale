import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import type { ConversationStatus } from '@/types/database'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { status, bot_paused } = await req.json()

  if (status === undefined && bot_paused === undefined) {
    return NextResponse.json({ error: 'status ou bot_paused são obrigatórios' }, { status: 400 })
  }
  if (status !== undefined && !['open', 'resolved', 'handoff'].includes(status)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }
  if (bot_paused !== undefined && typeof bot_paused !== 'boolean') {
    return NextResponse.json({ error: 'bot_paused inválido' }, { status: 400 })
  }

  const updates: { status?: ConversationStatus; resolved_at?: string | null; bot_paused?: boolean } = {}
  if (status !== undefined) {
    updates.status = status as ConversationStatus
    updates.resolved_at = status === 'resolved' ? new Date().toISOString() : null
  }
  if (bot_paused !== undefined) {
    updates.bot_paused = bot_paused
  }

  const { data, error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
