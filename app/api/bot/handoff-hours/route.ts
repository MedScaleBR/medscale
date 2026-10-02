import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const denied = requireRole(session, ['owner', 'admin'])
  if (denied) return denied
  const global = req.nextUrl.searchParams.get('scope') === 'global'
  const supabase = await createClient()
  const query = global
    ? supabase.from('account_handoff_hours').select('*').eq('account_id', session.accountId)
    : supabase.from('handoff_hours').select('*').eq('workspace_id', session.workspaceId)
  const { data, error } = await query
    .order('day_of_week')
    .order('start_time')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const denied = requireRole(session, ['owner', 'admin'])
  if (denied) return denied
  const global = req.nextUrl.searchParams.get('scope') === 'global'
  const body = await req.json().catch(() => null)
  const validTime = (time: unknown): time is string => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)
  if (!body || !Number.isInteger(body.day_of_week) || body.day_of_week < 0 || body.day_of_week > 6 ||
      !validTime(body.start_time) || !validTime(body.end_time) || body.start_time.padEnd(8, ':00') >= body.end_time.padEnd(8, ':00') ||
      (body.is_active !== undefined && typeof body.is_active !== 'boolean')) {
    return NextResponse.json({ error: 'Informe um dia válido e horários de início e fim válidos, com início anterior ao fim.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from(global ? 'account_handoff_hours' : 'handoff_hours')
    .insert({
      ...(global ? { account_id: session.accountId } : { workspace_id: session.workspaceId }),
      day_of_week: body.day_of_week,
      start_time: body.start_time,
      end_time: body.end_time,
      is_active: body.is_active ?? true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
