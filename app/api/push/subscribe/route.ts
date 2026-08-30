import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

// POST { endpoint, keys: { p256dh, auth }, userAgent? }
// Upsert da subscription do browser do usuário autenticado para a workspace
// ativa. onConflict em (workspace_id, endpoint) — p256dh/auth podem mudar
// quando o browser revoga e recria a subscription.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json().catch(() => null)
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth

  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'endpoint e keys (p256dh, auth) são obrigatórios' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: session.userId,
      workspace_id: session.workspaceId,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 500) : null,
    },
    { onConflict: 'workspace_id,endpoint' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}
