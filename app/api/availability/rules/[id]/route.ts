import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import type { Database } from '@/types/database'
import { parseRecurrence } from '@/lib/scheduling/rule-input'

type AvailabilityRuleUpdate = Database['public']['Tables']['availability_rules']['Update']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()

  // Allow-list — não repassar o corpo cru (workspace_id/doctor_id não são
  // editáveis por aqui).
  const update: AvailabilityRuleUpdate = {}
  for (const field of ['day_of_week', 'start_time', 'end_time', 'slot_duration', 'is_active'] as const) {
    if (field in body) update[field] = body[field]
  }
  // Repetição: valida contra o dia da semana final (o do pedido ou o atual).
  if ('day_of_week' in body || 'interval_weeks' in body || 'anchor_date' in body) {
    const { data: current } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', session.workspaceId)
      .maybeSingle()
    if (!current) return NextResponse.json({ error: 'Horário não encontrado.' }, { status: 404 })
    const row = current as { interval_weeks?: number | null; anchor_date?: string | null; day_of_week: number }
    const merged = {
      interval_weeks: 'interval_weeks' in body ? body.interval_weeks : (row.interval_weeks ?? 1),
      anchor_date: 'anchor_date' in body ? body.anchor_date : (row.anchor_date ?? null),
    }
    const recurrence = parseRecurrence('day_of_week' in body ? body.day_of_week : row.day_of_week, merged)
    if (!recurrence.ok) return NextResponse.json({ error: recurrence.error }, { status: 400 })
    if ('interval_weeks' in body || 'anchor_date' in body) Object.assign(update, recurrence.value)
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('availability_rules')
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

  const supabase = await createClient()
  const { error } = await supabase.from('availability_rules').delete().eq('id', id).eq('workspace_id', session.workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
