import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const [{ data: patient, error }, { data: appointments }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).eq('account_id', session.accountId).single(),
    // Histórico completo do paciente, entre todas as workspaces do account
    supabase
      .from('appointments')
      .select('*')
      .eq('patient_id', id)
      .eq('account_id', session.accountId)
      .order('scheduled_at', { ascending: false }),
  ])

  if (error || !patient) return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
  return NextResponse.json({ ...patient, appointments: appointments ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()
  const { data, error } = await supabase
    .from('patients')
    .update(body)
    .eq('id', id)
    .eq('account_id', session.accountId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { error } = await supabase.from('patients').delete().eq('id', id).eq('account_id', session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
