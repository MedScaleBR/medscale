import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type AccountTaskUpdate = Database['public']['Tables']['account_tasks']['Update']

async function requireMedscaleAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { supabase }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const body = await req.json()
  const update: AccountTaskUpdate = {}
  for (const field of ['title', 'description', 'due_date', 'assigned_to', 'status'] as const) {
    if (field in body) update[field] = body[field]
  }
  if (update.status === 'done') update.completed_at = new Date().toISOString()
  if (update.status === 'pending') update.completed_at = null

  const { data, error } = await supabase.from('account_tasks').update(update).eq('id', taskId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const { error } = await supabase.from('account_tasks').delete().eq('id', taskId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
