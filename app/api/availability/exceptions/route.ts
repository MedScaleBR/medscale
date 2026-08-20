import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const from = req.nextUrl.searchParams.get('from')

  let query = supabase.from('availability_exceptions').select('*').eq('workspace_id', session.workspaceId).order('date')
  if (from) query = query.gte('date', from)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()
  if (!body.date || !body.type) {
    return NextResponse.json({ error: 'date e type são obrigatórios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('availability_exceptions')
    .insert({
      workspace_id: session.workspaceId,
      doctor_id: session.userId,
      date: body.date,
      type: body.type,
      start_time: body.start_time ?? null,
      end_time: body.end_time ?? null,
      reason: body.reason ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
