import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google/auth'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // Conexão única por account (atende todas as unidades).
  const url = getAuthUrl(session.accountId)
  return NextResponse.redirect(url)
}
