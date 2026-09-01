import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google/auth'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // A conexão do Google Calendar é única por account e afeta a agenda de todas
  // as unidades — só owner/admin conecta (mesmo critério do disconnect).
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  // Conexão única por account (atende todas as unidades).
  const url = getAuthUrl(session.accountId)
  return NextResponse.redirect(url)
}
