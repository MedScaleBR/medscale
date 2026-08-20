import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { getAvailableSlots } from '@/lib/google/availability'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')
  const date = new Date(`${dateStr}T00:00:00-03:00`)

  const slots = await getAvailableSlots(session.workspaceId, date)

  return NextResponse.json({
    date: dateStr,
    slots: slots.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      available: s.available,
      label: format(s.start, 'HH:mm'),
    })),
  })
}
