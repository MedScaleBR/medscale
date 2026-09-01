import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import type { Database } from '@/types/database'

type WaitlistUpdate = Database['public']['Tables']['waitlist']['Update']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'waitlist')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const body = await req.json()

  // Allow-list — não repassar o corpo cru (account_id/workspace_id/patient_id
  // não devem ser alteráveis pelo cliente).
  const update: WaitlistUpdate = {}
  for (const field of [
    'status',
    'notes',
    'patient_name',
    'patient_phone',
    'doctor_id',
    'preferred_days',
    'preferred_times',
  ] as const) {
    if (field in body) update[field] = body[field]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('waitlist')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
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
  const moduleCheck = requireModule(session, 'waitlist')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const { error } = await supabase.from('waitlist').delete().eq('id', id).eq('workspace_id', session.workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
