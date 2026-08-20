import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { AccountDetailForm } from '@/components/admin/AccountDetailForm'
import { MembersList, type MemberRow } from '@/components/admin/MembersList'
import type { ModuleSlug } from '@/types/database'

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: account }, { data: membershipsRaw }] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', id).single(),
    supabase
      .from('memberships')
      .select('id, role, status, user_id, profiles:user_id(full_name, email)')
      .eq('account_id', id)
      .order('invited_at'),
  ])

  if (!account) notFound()

  type MembershipRow = { id: string; role: MemberRow['role']; status: MemberRow['status']; profiles: { full_name: string; email: string | null } | null }
  const members: MemberRow[] = ((membershipsRaw ?? []) as unknown as MembershipRow[]).map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    userName: m.profiles?.full_name ?? 'Sem nome',
    userEmail: m.profiles?.email ?? '—',
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

      <MembersList accountId={id} initialMembers={members} />
    </div>
  )
}
