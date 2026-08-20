import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDashboardStats } from '@/lib/dashboard'
import { requireWorkspaceSession } from '@/lib/session/api'
import { resolveActiveSession } from '@/lib/session/server'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const view = req.nextUrl.searchParams.get('view')

  let workspaceIds = [session.workspaceId]
  if (view === 'consolidated') {
    const activeSession = await resolveActiveSession()
    if (activeSession) workspaceIds = activeSession.allWorkspaces.map((w) => w.id)
  }

  const stats = await getDashboardStats(supabase, workspaceIds)
  return NextResponse.json(stats)
}
