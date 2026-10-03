import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTaskStatus, Database } from '@/types/database'

// Regras de transição de status das tarefas do kanban, compartilhadas entre o
// POST (re-criação idempotente) e o PATCH de /api/admin/tasks.

export interface TaskStatusTransition {
  status: AccountTaskStatus
  /** Só presente quando muda: undefined = não mexer em completed_at. */
  completed_at?: string | null
  /** Entrou em done agora (antes não era). */
  becameDone: boolean
}

// completed_at registra quando a tarefa foi concluída — só muda numa
// transição real. Reenviar done para uma tarefa já concluída não pode
// sobrescrever a data original.
export function taskStatusTransition(
  previous: AccountTaskStatus,
  next: AccountTaskStatus,
  now: Date = new Date(),
): TaskStatusTransition {
  if (next === 'done' && previous !== 'done') {
    return { status: next, completed_at: now.toISOString(), becameDone: true }
  }
  if (previous === 'done' && next !== 'done') {
    return { status: next, completed_at: null, becameDone: false }
  }
  return { status: next, becameDone: false }
}

// Concluir a tarefa de um feedback marca o feedback como lido. Best-effort: a
// tarefa já foi salva, então a falha aqui só vai para o Sentry (o supabase-js
// não lança — o erro vem no retorno).
export async function markFeedbackReviewed(supabase: SupabaseClient<Database>, feedbackId: string): Promise<void> {
  const { error } = await supabase.from('feedback').update({ status: 'reviewed' }).eq('id', feedbackId)
  if (error) {
    Sentry.captureException(new Error(error.message), { tags: { area: 'admin', flow: 'feedback_reviewed' } })
  }
}
