import { createClient } from '@/lib/supabase/server'
import { getMedscaleAdmins } from '@/lib/admin/admins'
import { getAdminQueue, saoPauloDate } from '@/lib/admin/queue'
import { TaskBoard } from '@/components/admin/tasks/TaskBoard'
import { inboxId, taskFromRow, type InboxCard, type PersonOption } from '@/components/admin/tasks/board-logic'

export default async function AdminTasksPage() {
  const supabase = await createClient()

  const [
    {
      data: { user },
    },
    { data: tasksRaw, error },
    { data: accountsRaw },
    admins,
    queue,
  ] = await Promise.all([
    supabase.auth.getUser(),
    // Todas as tarefas: o quadro mostra abertas + concluídas dos últimos 7 dias;
    // o modo Lista também lista as concluídas antigas.
    supabase
      .from('account_tasks')
      .select(
        'id, title, description, due_date, status, position, assigned_to, account_id, source_type, source_ref, completed_at, created_at, accounts(name)',
      )
      .order('position'),
    supabase.from('accounts').select('id, name').order('name'),
    getMedscaleAdmins(),
    getAdminQueue(supabase),
  ])

  const loadError = error
    ? 'Não foi possível carregar as tarefas. Recarregue a página para tentar de novo.'
    : queue.error
      ? 'Não foi possível carregar a Entrada (alertas e feedbacks). Recarregue a página para tentar de novo.'
      : null

  const people: PersonOption[] = admins.map((a) => ({ id: a.id, name: a.full_name || null, email: a.email }))

  const tasks = (tasksRaw ?? []).map((t) => taskFromRow(t, { accountName: t.accounts?.name ?? null, people }))

  // Entrada: alertas de custo e feedbacks sem tarefa, na ordem da fila.
  const inbox: InboxCard[] = queue.items
    .filter((i) => i.kind !== 'task' && i.ref && i.sourceType)
    .map((i, order) => ({
      id: inboxId(i.ref!),
      ref: i.ref!,
      sourceType: i.sourceType!,
      title: i.title,
      detail: (i.kind === 'alert' ? i.detail : i.message) ?? null,
      accountId: i.accountId,
      accountName: i.accountName,
      age: i.age,
      cost: i.cost ?? null,
      order,
    }))

  return (
    <TaskBoard
      initialTasks={tasks}
      initialInbox={inbox}
      admins={people}
      accounts={accountsRaw ?? []}
      currentUserId={user?.id ?? null}
      today={saoPauloDate(new Date())}
      loadError={loadError}
    />
  )
}
