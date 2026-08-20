import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'waitlist')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('waitlist')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'waitlist')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const body = await req.json()
  if (!body.patient_name || !body.patient_phone) {
    return NextResponse.json({ error: 'patient_name e patient_phone são obrigatórios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('waitlist')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      patient_id: body.patient_id ?? null,
      patient_name: body.patient_name,
      patient_phone: body.patient_phone,
      doctor_id: session.userId,
      preferred_days: body.preferred_days ?? null,
      preferred_times: body.preferred_times ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
