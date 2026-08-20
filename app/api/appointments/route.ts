import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createEvent } from '@/lib/google/calendar'
import { isGoogleConnected } from '@/lib/google/auth'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'agenda')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  let query = supabase.from('appointments').select('*').eq('workspace_id', session.workspaceId).order('scheduled_at')

  if (from) query = query.gte('scheduled_at', from)
  if (to) query = query.lte('scheduled_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'agenda')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const body = await req.json()
  if (!body.patient_name || !body.patient_phone || !body.scheduled_at) {
    return NextResponse.json(
      { error: 'patient_name, patient_phone e scheduled_at são obrigatórios' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      doctor_id: session.userId,
      patient_id: body.patient_id ?? null,
      patient_name: body.patient_name,
      patient_phone: body.patient_phone,
      scheduled_at: body.scheduled_at,
      duration_min: body.duration_min ?? 30,
      type: body.type ?? 'consulta',
      source: 'manual',
      status: body.status ?? 'agendado',
      notes: body.notes ?? null,
      price: body.price ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sincroniza com o Google Calendar quando conectado — best-effort, não
  // bloqueia a criação do agendamento no CRM se o Google falhar.
  const { connected, email } = await isGoogleConnected(session.workspaceId)
  if (connected && email) {
    try {
      const { data: workspace } = await supabase.from('workspaces').select('name').eq('id', session.workspaceId).single()

      const gcalEvent = await createEvent({
        workspaceId: session.workspaceId,
        patientName: body.patient_name,
        patientEmail: body.patient_email,
        patientPhone: body.patient_phone,
        appointmentType: body.type ?? 'consulta',
        startTime: new Date(body.scheduled_at),
        durationMin: body.duration_min ?? 30,
        notes: body.notes,
        workspaceName: workspace?.name ?? 'MedScale',
        doctorEmail: email,
      })

      if (gcalEvent.id) {
        await supabase.from('appointments').update({ gcal_event_id: gcalEvent.id }).eq('id', data.id)
        data.gcal_event_id = gcalEvent.id
      }
    } catch (gcalErr) {
      console.error('Google Calendar sync failed:', gcalErr)
    }
  }

  return NextResponse.json(data, { status: 201 })
}
