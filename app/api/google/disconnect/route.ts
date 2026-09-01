import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedClient } from '@/lib/google/auth'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // Desconectar o Google Calendar derruba a agenda de todas as unidades — só
  // owner/admin (mesmo critério de /api/bot/onboarding/disconnect).
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const supabase = await createClient()

  try {
    // Revogar o token na Google antes de deletar do banco
    const auth = await getAuthenticatedClient(session.accountId)
    const { token } = await auth.getAccessToken()
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' })
    }
  } catch {
    // Continua mesmo se a revogação falhar (ex.: já desconectado)
  }

  const { error } = await supabase.from('google_tokens').delete().eq('account_id', session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Zera o mapeamento unidade → calendário: sem conexão, não há calendários.
  await supabase.from('workspaces').update({ gcal_calendar_id: null }).eq('account_id', session.accountId)

  return NextResponse.json({ ok: true })
}
