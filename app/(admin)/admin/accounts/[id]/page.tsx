import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { AccountDetailForm } from '@/components/admin/AccountDetailForm'
import { MembersList, type MemberRow, type PendingInvite } from '@/components/admin/MembersList'
import type { ModuleSlug } from '@/types/database'

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: account },
    { data: membershipsRaw, error: membershipsError },
    { data: invitesRaw },
  ] = await Promise.all([
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
  ])

  if (membershipsError) console.error('Erro ao buscar memberships:', membershipsError.message)

  if (!account) notFound()

  // Busca separada em vez de embed (profiles:user_id(...)) — memberships.user_id
  // e profiles.id referenciam auth.users cada um por si, sem FK direta entre
  // memberships e profiles, então o PostgREST não consegue resolver esse
  // embed automaticamente (retorna erro de relacionamento não encontrado).
  const userIds = (membershipsRaw ?? []).map((m) => m.user_id)
  const { data: profilesRaw, error: profilesError } =
    userIds.length > 0
      ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
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

      <AccountDetailForm
        accountId={id}
        initialPlan={account.plan}
        initialModules={account.modules as ModuleSlug[]}
        initialIsActive={account.is_active}
      />

      <MembersList accountId={id} initialMembers={members} initialInvites={pendingInvites} />
    </div>
  )
}
