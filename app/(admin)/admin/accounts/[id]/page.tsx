import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getMedscaleAdmins } from '@/lib/admin/admins'
import { AccountDetailForm } from '@/components/admin/AccountDetailForm'
import { MembersList, type MemberRow, type PendingInvite } from '@/components/admin/MembersList'
import { AccountActivityTab, type NoteRow } from '@/components/admin/AccountActivityTab'
import { AccountTasksTab, type TaskRow } from '@/components/admin/AccountTasksTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ModuleSlug } from '@/types/database'

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/admin/accounts" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Accounts
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium text-gray-900">{account.name}</h1>
            <p className="text-sm text-gray-400">{account.slug}</p>
          </div>
          <Link
            href={`/admin/accounts/${id}/workspaces`}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--navy-06)] bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-[var(--cyan)]"
          >
            <MapPin className="h-3.5 w-3.5" />
            Gerenciar unidades
          </Link>
        </div>
      </div>

      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">Plano e membros</TabsTrigger>
          <TabsTrigger value="activity">Atividade</TabsTrigger>
          <TabsTrigger value="tasks">Tarefas</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-4 space-y-6">
          <AccountDetailForm
            accountId={id}
            initialPlan={account.plan}
            initialModules={account.modules as ModuleSlug[]}
            initialIsActive={account.is_active}
          />
          <MembersList accountId={id} initialMembers={members} initialInvites={pendingInvites} />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <AccountActivityTab accountId={id} initialNotes={notes} currentAdminName={currentAdminName} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <AccountTasksTab accountId={id} initialTasks={tasks} admins={adminOptions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
