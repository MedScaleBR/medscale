import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { syncAdsForAccount } from '@/lib/meta/ads-sync'

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const { synced, skipped } = await syncAdsForAccount(session.accountId)

  if (skipped === 'no_token') {
    return NextResponse.json({ error: 'Conecte sua conta do Facebook primeiro.' }, { status: 409 })
  }
  if (skipped === 'token_expired') {
    return NextResponse.json(
      { error: 'Sua conexão com o Facebook expirou. Reconecte nas configurações.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true, synced })
}
