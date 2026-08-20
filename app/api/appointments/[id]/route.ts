import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cancelEvent, updateEvent } from '@/lib/google/calendar'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()
  const { data, error } = await supabase
    .from('appointments')
    .update(body)
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sincroniza com o Google Calendar quando o agendamento tem um evento vinculado
  if (data.gcal_event_id) {
    try {
      if (body.status === 'cancelado') {
        await cancelEvent(session.workspaceId, data.gcal_event_id)
      } else if (body.scheduled_at || body.duration_min) {
        await updateEvent(session.workspaceId, data.gcal_event_id, {
          startTime: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
          durationMin: body.duration_min,
          notes: body.notes,
        })
      }
    } catch (gcalErr) {
      console.error('Google Calendar update failed:', gcalErr)
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select('gcal_event_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (data?.gcal_event_id) {
    try {
      await cancelEvent(session.workspaceId, data.gcal_event_id)
    } catch (gcalErr) {
      console.error('Google Calendar cancel failed:', gcalErr)
    }
  }

  return NextResponse.json({ ok: true })
}
