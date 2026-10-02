import { createClient } from '@/lib/supabase/server'
import { getMedscaleAdmins } from '@/lib/admin/admins'
import { GlobalTasksList, type GlobalTaskRow } from '@/components/admin/GlobalTasksList'

export default async function AdminTasksPage() {
  const supabase = await createClient()

  const [{ data: tasksRaw, error }, { data: accountsRaw }, admins] = await Promise.all([
    supabase
      .from('account_tasks')
      .select('id, title, description, due_date, status, assigned_to, account_id, accounts(name)')
      .order('created_at', { ascending: false }),
    supabase.from('accounts').select('id, name').order('name'),
    getMedscaleAdmins(),
  ])

  if (error) console.error('Erro ao buscar account_tasks:', error.message)

  const adminsById = new Map(admins.map((a) => [a.id, a]))

  const tasks: GlobalTaskRow[] = (tasksRaw ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: t.due_date,
    status: t.status,
    accountId: t.account_id,
    accountName: t.accounts?.name ?? null,
    assignedTo: t.assigned_to,
    assigneeName: (t.assigned_to && adminsById.get(t.assigned_to)?.full_name) ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Tarefas</h1>
        <p className="text-sm text-gray-400">Follow-ups de todas as accounts, e tarefas internas sem cliente atrelado</p>
      </div>

      <GlobalTasksList
        tasks={tasks}
        admins={admins.map((a) => ({ id: a.id, name: a.full_name || a.email || 'Admin' }))}
        accounts={accountsRaw ?? []}
      />
    </div>
  )
}
