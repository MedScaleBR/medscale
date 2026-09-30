import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole, type ApiSession } from '@/lib/session/api'

// Porta de entrada das rotas /api/billing/*: sessão → módulo "billing" ativo
// na ACCOUNT (não no module_overrides do usuário — a recepção precisa do
// seletor de convênio mesmo com módulos restritos) → papel, quando exigido.
// Guias e lotes também são protegidos pela RLS (is_account_admin); isto é a
// segunda das três camadas (UI, API, RLS).
export async function requireBilling(
  req: NextRequest,
  { adminOnly }: { adminOnly: boolean },
): Promise<{ session: ApiSession } | { error: NextResponse }> {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result
  const { session } = result

  const supabase = await createClient()
  const { data: account } = await supabase.from('accounts').select('modules').eq('id', session.accountId).maybeSingle()
  if (!account?.modules?.includes('billing')) {
    return { error: NextResponse.json({ error: "Módulo 'billing' não está ativo no seu plano" }, { status: 403 }) }
  }

  if (adminOnly) {
    const denied = requireRole(session, ['owner', 'admin'])
    if (denied) return { error: denied }
  }

  return { session }
}
