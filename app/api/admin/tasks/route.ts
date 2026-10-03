import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { markFeedbackReviewed, taskStatusTransition } from '@/lib/admin/task-status'
import type { AccountTaskSourceType, AccountTaskStatus } from '@/types/database'

const STATUSES: readonly AccountTaskStatus[] = ['todo', 'doing', 'done']
const SOURCE_TYPES: readonly AccountTaskSourceType[] = ['cost_alert', 'feedback']

// Tarefa opcionalmente atrelada a uma account — account_id pode vir vazio
// para uma tarefa interna sem cliente associado. Tarefas criadas a partir de
// um alerta de custo ou feedback carregam (source_type, source_ref), que é
// único: criar de novo a partir da mesma origem devolve a tarefa existente
// (aplicando o status pedido, se veio um diferente).
export async function POST(req: NextRequest) {
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase, user } = result

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Dados da tarefa inválidos' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'Título é obrigatório' }, { status: 400 })

  const status: AccountTaskStatus = body.status ?? 'todo'
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Status inválido. Use todo, doing ou done.' }, { status: 400 })
  }

  if (body.position !== undefined && (typeof body.position !== 'number' || !Number.isFinite(body.position))) {
    return NextResponse.json({ error: 'Posição inválida' }, { status: 400 })
  }

  const sourceType: AccountTaskSourceType | null = body.source_type || null
  const sourceRef = typeof body.source_ref === 'string' ? body.source_ref.trim() : ''
  if (sourceType !== null && !SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: 'Origem da tarefa inválida' }, { status: 400 })
  }
  if (sourceType && !sourceRef) {
    return NextResponse.json({ error: 'Informe a referência da origem da tarefa' }, { status: 400 })
  }

  // Sem posição explícita, o cartão entra no fim da coluna: 1024 depois do
  // último (mesmo espaçamento do backfill da migração v3).
  let position: number = body.position
  if (position === undefined) {
    const { data: last, error: lastError } = await supabase
      .from('account_tasks')
      .select('position')
      .eq('status', status)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastError) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })
    position = (last?.position ?? 0) + 1024
  }

  const { data, error } = await supabase
    .from('account_tasks')
    .insert({
      account_id: body.account_id || null,
      title,
      description: body.description || null,
      due_date: body.due_date || null,
      assigned_to: body.assigned_to || null,
      status,
      position,
      source_type: sourceType,
      source_ref: sourceType ? sourceRef : null,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // Índice único em (source_type, source_ref): a tarefa daquela origem já
    // existe — responde com ela em vez de falhar.
    if (error.code === '23505' && sourceType) {
      const { data: existing } = await supabase
        .from('account_tasks')
        .select()
        .eq('source_type', sourceType)
        .eq('source_ref', sourceRef)
        .maybeSingle()
      if (!existing) return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })

      // Pediu explicitamente outro status (ex. arrastou para Concluídas uma
      // origem que já tinha tarefa): mesma transição do PATCH. Sem status no
      // corpo, só devolve a existente — não reabre tarefa concluída.
      if ('status' in body && existing.status !== status) {
        const { becameDone, ...update } = taskStatusTransition(existing.status, status)
        const { data: updated, error: updateError } = await supabase
          .from('account_tasks')
          .update(update)
          .eq('id', existing.id)
          .select()
          .single()
        if (updateError || !updated) {
          return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })
        }
        if (becameDone && sourceType === 'feedback') await markFeedbackReviewed(supabase, sourceRef)
        return NextResponse.json(updated, { status: 200 })
      }
      return NextResponse.json(existing, { status: 200 })
    }
    return NextResponse.json({ error: 'Não foi possível salvar a tarefa' }, { status: 500 })
  }

  // Feedback arrastado direto para Concluídas: mesma regra do PATCH.
  if (status === 'done' && sourceType === 'feedback') await markFeedbackReviewed(supabase, sourceRef)

  return NextResponse.json(data, { status: 201 })
}
