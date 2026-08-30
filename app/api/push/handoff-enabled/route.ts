import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

// PATCH { enabled: boolean }
// Liga/desliga memberships.handoff_push_enabled do usuário autenticado na
// account ativa. Qualquer role configura o próprio.
export async function PATCH(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) é obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('memberships')
    .update({ handoff_push_enabled: body.enabled })
    .eq('user_id', session.userId)
    .eq('account_id', session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, enabled: body.enabled })
}
