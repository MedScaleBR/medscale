import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import type { AccountTaskStatus, Database } from '@/types/database'

type AccountTaskUpdate = Database['public']['Tables']['account_tasks']['Update']

const STATUSES: readonly AccountTaskStatus[] = ['todo', 'doing', 'done']
const EDITABLE_FIELDS = ['title', 'description', 'due_date', 'assigned_to'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Dados da tarefa inválidos' }, { status: 400 })
  }

  const update: AccountTaskUpdate = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field]
  }

  if ('status' in body) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Status inválido. Use todo, doing ou done.' }, { status: 400 })
    }
    update.status = body.status as AccountTaskStatus
    update.completed_at = update.status === 'done' ? new Date().toISOString() : null
  }

  if ('position' in body) {
    if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
      return NextResponse.json({ error: 'Posição inválida' }, { status: 400 })
    }
    update.position = body.position
  }

  const { data, error } = await supabase.from('account_tasks').update(update).eq('id', taskId).select().single()
  if (error) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })

  // Concluir a tarefa de um feedback marca o feedback como lido. Best-effort:
  // a tarefa já foi salva, então uma falha aqui não derruba a requisição.
  if (update.status === 'done' && data?.source_type === 'feedback' && data.source_ref) {
    try {
      await supabase.from('feedback').update({ status: 'reviewed' }).eq('id', data.source_ref)
    } catch {
      // ignora
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const { error } = await supabase.from('account_tasks').delete().eq('id', taskId)
  if (error) return NextResponse.json({ error: 'Não foi possível excluir a tarefa' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
