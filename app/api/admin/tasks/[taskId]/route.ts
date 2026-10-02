import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { markFeedbackReviewed, taskStatusTransition } from '@/lib/admin/task-status'
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

  if ('status' in body && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Status inválido. Use todo, doing ou done.' }, { status: 400 })
  }

  if ('position' in body) {
    if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
      return NextResponse.json({ error: 'Posição inválida' }, { status: 400 })
    }
    update.position = body.position
  }

  // completed_at só muda em transição real: lê o status atual antes. Reenviar
  // done (duplo clique, reordenar dentro de Concluídas) não reescreve a data.
  let becameDone = false
  if ('status' in body) {
    const { data: current, error: currentError } = await supabase
      .from('account_tasks')
      .select('status')
      .eq('id', taskId)
      .maybeSingle()
    if (currentError) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })
    if (!current) return NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 })

    const transition = taskStatusTransition(current.status, body.status as AccountTaskStatus)
    update.status = transition.status
    if (transition.completed_at !== undefined) update.completed_at = transition.completed_at
    becameDone = transition.becameDone
  }

  const { data, error } = await supabase.from('account_tasks').update(update).eq('id', taskId).select().single()
  if (error) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })

  // Concluir a tarefa de um feedback marca o feedback como lido — só na
  // transição para done, best-effort (ver markFeedbackReviewed).
  if (becameDone && data?.source_type === 'feedback' && data.source_ref) {
    await markFeedbackReviewed(supabase, data.source_ref)
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
