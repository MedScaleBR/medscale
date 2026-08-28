import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createEvent, cancelEvent } from '@/lib/google/calendar'
import { isGoogleConnected } from '@/lib/google/auth'
import { reconcileCalendar } from '@/lib/google/reconcile'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import { applyAppointmentRevenue } from '@/lib/revenue/cycle'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'agenda')
  if (moduleCheck) return moduleCheck

  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam = req.nextUrl.searchParams.get('to')
  const now = new Date()
  const from = fromParam ? new Date(fromParam) : new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = toParam ? new Date(toParam) : new Date(now.getFullYear(), now.getMonth() + 2, 0)

  const reconciled = await reconcileCalendar(session.workspaceId, from, to)
  return NextResponse.json(reconciled)
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

  // Convênio da consulta (bot_config.insurance_plans). Consulta por convênio
  // fica fora do ciclo de receita: sem preço, sem procedimento, sem entrada.
  const healthPlan: string | null =
    typeof body.health_plan === 'string' && body.health_plan.trim() ? body.health_plan.trim() : null

  // Ciclo de receita: se veio um procedimento do catálogo, tira o snapshot de
  // nome e preço agora (imutável). Um body.price explícito tem prioridade.
  let procedureName: string | null = null
  let snapshotPrice: number | null = healthPlan ? null : (body.price ?? null)
  const procedureId: string | null = healthPlan ? null : (body.procedure_id ?? null)
  if (procedureId) {
    const { data: proc } = await supabase
      .from('procedure_catalog')
      .select('name, default_price')
      .eq('id', procedureId)
      .eq('workspace_id', session.workspaceId)
      .maybeSingle()
    if (proc) {
      procedureName = proc.name
      if (snapshotPrice == null) snapshotPrice = Number(proc.default_price)
    }
  }

  // Google Calendar é a fonte de verdade: se o workspace está conectado, o
  // evento precisa existir lá antes de gravarmos qualquer coisa no Supabase —
  // sem isso, uma falha do Google ficava em silêncio e o /agenda mostrava uma
  // consulta que não existia de verdade na agenda do médico.
  const { connected, email } = await isGoogleConnected(session.workspaceId)
  let gcalEventId: string | null = null

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
      gcalEventId = gcalEvent.id ?? null
    } catch (gcalErr) {
      console.error('Google Calendar create failed:', gcalErr)
      return NextResponse.json(
        { error: 'Não foi possível criar o evento no Google Calendar. A consulta não foi salva.' },
        { status: 502 }
      )
    }
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
      procedure_id: procedureId,
      procedure_name: procedureName,
      price: snapshotPrice,
      health_plan: healthPlan,
      gcal_event_id: gcalEventId,
    })
    .select()
    .single()

  if (error) {
    // Google já aceitou o evento mas o Supabase falhou — desfaz no Google pra
    // não deixar um evento órfão que o próximo reconcile reimportaria sem
    // nenhum dado de CRM por trás.
    if (gcalEventId) {
      try {
        await cancelEvent(session.workspaceId, gcalEventId)
      } catch (cleanupErr) {
        console.error('Google Calendar cleanup failed after Supabase insert error:', cleanupErr)
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Ciclo de receita: entrada PREVISTA ligada ao agendamento e, se a consulta
  // já nasce realizada/no-show, promove/cancela a entrada em seguida. Consulta
  // por convênio (healthPlan) fica fora do ciclo. Client admin (revenue_entries
  // é RLS exclusiva de owner). No-op se o módulo estiver inativo, sem preço
  // conhecido, ou já criada para este appointment.
  if (data) {
    await applyAppointmentRevenue(createAdminClient(), {
      booking: {
        workspaceId: session.workspaceId,
        accountId: session.accountId,
        appointmentId: data.id,
        patientId: data.patient_id ?? null,
        procedureId,
        procedureName,
        amount: snapshotPrice,
        scheduledAt: data.scheduled_at,
        source: 'manual',
      },
      previousStatus: null,
      nextStatus: data.status,
      healthPlan,
    })
  }

  return NextResponse.json(data, { status: 201 })
}
