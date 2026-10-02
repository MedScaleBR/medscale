import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/supabase/paginate'
import { getMedscaleAdmins } from '@/lib/admin/admins'
import { MAX_EVENTS } from '@/lib/admin/cost-alerts'
import { sumCost } from '@/lib/admin/accounts'
import { formatDateBR, initialsFrom } from '@/lib/admin/format'
import { OPEN_TASK_STATUSES, isOverdue, saoPauloDate } from '@/lib/admin/queue'
import { AccountDetailForm } from '@/components/admin/AccountDetailForm'
import { MembersList, type MemberRow, type PendingInvite } from '@/components/admin/MembersList'
import { AccountActivityTab, type NoteRow } from '@/components/admin/AccountActivityTab'
import { AccountTasksTab, type TaskRow } from '@/components/admin/AccountTasksTab'
import { AccountTabs } from '@/components/admin/account/AccountTabs'
import { AccountSidebar, type SidebarTask } from '@/components/admin/account/AccountSidebar'
import { PlanBadge, StatusBadge } from '@/components/admin/account/AccountBadges'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AccountNoteType, ModuleSlug } from '@/types/database'

const NOTE_TYPE_LABEL: Record<AccountNoteType, string> = {
  note: 'Nota',
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
}

const DAY_MS = 24 * 60 * 60 * 1000

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const now = new Date()
  const since30d = new Date(now.getTime() - 30 * DAY_MS).toISOString()

  const [
    {
      data: { user },
    },
    { data: account },
    { data: membershipsRaw, error: membershipsError },
    { data: invitesRaw },
    { data: notesRaw, error: notesError },
    { data: tasksRaw, error: tasksError },
    admins,
    { count: workspacesCount, error: workspacesError },
    { rows: costList, truncated: costTruncated, error: costError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('accounts').select('*').eq('id', id).single(),
    supabase
      .from('memberships')
      .select('id, role, status, user_id')
      .eq('account_id', id)
      .order('invited_at'),
    supabase
      .from('invites')
      .select('id, email, role, expires_at')
      .eq('account_id', id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('account_notes')
      .select('id, type, body, created_by, created_at')
      .eq('account_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('account_tasks')
      .select('id, title, description, due_date, status, assigned_to')
      .eq('account_id', id)
      .order('created_at', { ascending: false }),
    getMedscaleAdmins(),
    supabase.from('workspaces').select('id', { count: 'exact', head: true }).eq('account_id', id),
    fetchAllPages(
      (from, to) =>
        supabase
          .from('cost_events')
          .select('cost_brl')
          .eq('account_id', id)
          .gte('created_at', since30d)
          .order('created_at')
          .order('id')
          .range(from, to),
      { max: MAX_EVENTS },
    ),
  ])

  if (membershipsError) console.error('Erro ao buscar memberships:', membershipsError.message)
  if (notesError) console.error('Erro ao buscar account_notes:', notesError.message)
  if (tasksError) console.error('Erro ao buscar account_tasks:', tasksError.message)

  if (!account) notFound()

  // Busca separada em vez de embed (profiles:user_id(...)) — memberships.user_id,
  // account_notes.created_by e account_tasks.assigned_to/created_by referenciam
  // auth.users, e profiles.id referencia auth.users cada um por si, sem FK direta
  // entre essas tabelas e profiles, então o PostgREST não consegue resolver esse
  // embed automaticamente (retorna erro de relacionamento não encontrado).
  const userIds = new Set<string>()
  ;(membershipsRaw ?? []).forEach((m) => userIds.add(m.user_id))
  ;(notesRaw ?? []).forEach((n) => n.created_by && userIds.add(n.created_by))
  ;(tasksRaw ?? []).forEach((t) => t.assigned_to && userIds.add(t.assigned_to))

  const { data: profilesRaw, error: profilesError } =
    userIds.size > 0
      ? await supabase.from('profiles').select('id, full_name, email').in('id', Array.from(userIds))
      : { data: [], error: null }

  if (profilesError) console.error('Erro ao buscar profiles:', profilesError.message)

  const profilesById = new Map((profilesRaw ?? []).map((p) => [p.id, p]))

  const members: MemberRow[] = (membershipsRaw ?? []).map((m) => {
    const profile = profilesById.get(m.user_id)
    return {
      id: m.id,
      role: m.role,
      status: m.status,
      userName: profile?.full_name ?? 'Sem nome',
      userEmail: profile?.email ?? '—',
    }
  })

  const pendingInvites: PendingInvite[] = (invitesRaw ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expired: new Date(i.expires_at) < new Date(),
  }))

  const notes: NoteRow[] = (notesRaw ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    body: n.body,
    authorName: (n.created_by && profilesById.get(n.created_by)?.full_name) ?? 'Admin',
    createdAt: n.created_at,
  }))

  const tasks: TaskRow[] = (tasksRaw ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: t.due_date,
    status: t.status,
    assignedTo: t.assigned_to,
    assigneeName: (t.assigned_to && profilesById.get(t.assigned_to)?.full_name) ?? null,
  }))

  const adminOptions = admins.map((a) => ({ id: a.id, name: a.full_name || a.email || 'Admin' }))
  const currentAdminName = (user && profilesById.get(user.id)?.full_name) || user?.email || 'Admin'

  // Resumo lateral
  const today = saoPauloDate(now)
  const openTasks = tasks
    .filter((t) => OPEN_TASK_STATUSES.includes(t.status))
    .sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
  const sidebarTasks: SidebarTask[] = openTasks.slice(0, 3).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    overdue: isOverdue(t.dueDate, today),
    assigneeName: t.assigneeName,
  }))

  const owner = members.find((m) => m.role === 'owner' && m.status === 'active') ?? members.find((m) => m.role === 'owner')
  const ownerInvite = pendingInvites.find((i) => i.role === 'owner' && !i.expired)
  const ownerName = owner
    ? owner.userName !== 'Sem nome'
      ? owner.userName
      : owner.userEmail
    : ownerInvite
      ? `${ownerInvite.email} (convite pendente)`
      : null
  const lastNote = notes[0]

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/accounts"
          className="mb-3 inline-flex items-center gap-1 rounded text-xs text-gray-400 outline-none hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Accounts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cyan-10)] text-sm font-medium text-[var(--cyan-dark)]"
            >
              {initialsFrom(account.name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-medium text-gray-900">{account.name}</h1>
                <StatusBadge active={account.is_active} />
                <PlanBadge plan={account.plan} />
              </div>
              <p className="text-sm text-gray-400">
                {account.slug} · criada em {formatDateBR(account.created_at)}
              </p>
            </div>
          </div>
          <Link
            href={`/admin/accounts/${id}/workspaces`}
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'rounded-[10px] bg-white px-3.5 focus-visible:ring-2 focus-visible:ring-[var(--cyan)]')}
          >
            Gerenciar unidades
          </Link>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <AccountTabs
          activityCount={notes.length}
          openTasksCount={openTasks.length}
          plan={
            <>
              <AccountDetailForm
                accountId={id}
                initialPlan={account.plan}
                initialModules={account.modules as ModuleSlug[]}
                initialIsActive={account.is_active}
              />
              <MembersList accountId={id} initialMembers={members} initialInvites={pendingInvites} />
            </>
          }
          activity={<AccountActivityTab accountId={id} initialNotes={notes} currentAdminName={currentAdminName} />}
          tasks={<AccountTasksTab accountId={id} initialTasks={tasks} admins={adminOptions} today={today} />}
        />

        <AccountSidebar
          ownerName={ownerName}
          workspacesCount={workspacesError ? null : (workspacesCount ?? 0)}
          cost30d={costError ? null : sumCost(costList)}
          costTruncated={costTruncated}
          openTasks={sidebarTasks}
          lastActivity={
            lastNote
              ? {
                  typeLabel: NOTE_TYPE_LABEL[lastNote.type] ?? 'Nota',
                  body: lastNote.body,
                  authorName: lastNote.authorName,
                  createdAt: lastNote.createdAt,
                }
              : null
          }
        />
      </div>
    </div>
  )
}
