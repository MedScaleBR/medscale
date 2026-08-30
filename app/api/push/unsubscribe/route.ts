import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

// POST { endpoint }
// Remove a subscription do usuário autenticado. A policy de RLS já limita a
// auth.uid(); o filtro por user_id é defensivo.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json().catch(() => null)
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string') {
    return NextResponse.json({ error: 'endpoint é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', session.userId)
    .eq('endpoint', endpoint)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
