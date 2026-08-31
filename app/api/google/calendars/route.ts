import { NextRequest, NextResponse } from 'next/server'
import { listCalendars } from '@/lib/google/calendar'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  try {
    const calendars = await listCalendars(session.accountId)
    return NextResponse.json(calendars)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
