import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cancelEvent, updateEvent } from '@/lib/google/calendar'
import { requireWorkspaceSession } from '@/lib/session/api'
import { syncRevenueEntryToAppointmentStatus } from '@/lib/revenue/cycle'

// Google Calendar é a fonte de verdade: se a consulta tem um evento vinculado
// (gcal_event_id), a mudança precisa ser aceita lá antes de gravar no
// Supabase — antes o Google era só best-effort e uma falha silenciosa deixava
// o /agenda mostrando um estado que não batia com a agenda real do médico.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()

  const { data: current, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .single()

  if (fetchError || !current) {
    return NextResponse.json({ error: fetchError?.message ?? 'Consulta não encontrada' }, { status: 404 })
  }

  if (current.gcal_event_id) {
    const cancelling = body.status === 'cancelado' && current.status !== 'cancelado'
    const newStart = body.scheduled_at ? new Date(body.scheduled_at) : null
    const timeChanged =
      newStart !== null &&
      (newStart.getTime() !== new Date(current.scheduled_at).getTime() ||
        (body.duration_min != null && body.duration_min !== current.duration_min))
    const notesChanged = body.notes !== undefined && body.notes !== current.notes

    try {
      if (cancelling) {
        await cancelEvent(session.workspaceId, current.gcal_event_id)
      } else if (timeChanged || notesChanged) {
        await updateEvent(session.workspaceId, current.gcal_event_id, {
          startTime: newStart ?? undefined,
          durationMin: body.duration_min ?? current.duration_min,
          notes: body.notes,
        })
      }
      // Só status (confirmado/realizado/no_show) ou campos que o Google não
      // rastreia (price, patient_id) — nada pra sincronizar, segue direto.
    } catch (gcalErr) {
      console.error('Google Calendar update failed:', gcalErr)
      return NextResponse.json(
        { error: 'Não foi possível atualizar o evento no Google Calendar. Nenhuma alteração foi salva.' },
        { status: 502 }
      )
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(body)
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Ciclo de receita: encerrar/cancelar/no-show a consulta move a entrada de
  // receita vinculada. Client admin — revenue_entries é RLS exclusiva de
  // owner e quem edita a agenda pode ser admin/member. O id já foi validado
  // contra o workspace da sessão acima.
  if (typeof body.status === 'string' && body.status !== current.status) {
    await syncRevenueEntryToAppointmentStatus(createAdminClient(), id, body.status)
  }

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data: current, error: fetchError } = await supabase
    .from('appointments')
    .select('gcal_event_id, status')
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .single()

  if (fetchError || !current) {
    return NextResponse.json({ error: fetchError?.message ?? 'Consulta não encontrada' }, { status: 404 })
  }

  if (current.gcal_event_id && current.status !== 'cancelado') {
    try {
      await cancelEvent(session.workspaceId, current.gcal_event_id)
    } catch (gcalErr) {
      console.error('Google Calendar cancel failed:', gcalErr)
      return NextResponse.json(
        { error: 'Não foi possível cancelar o evento no Google Calendar. A consulta não foi cancelada.' },
        { status: 502 }
      )
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select('gcal_event_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (current.status !== 'cancelado') {
    await syncRevenueEntryToAppointmentStatus(createAdminClient(), id, 'cancelado')
  }

  return NextResponse.json({ ok: true, gcal_event_id: data?.gcal_event_id ?? null })
}
