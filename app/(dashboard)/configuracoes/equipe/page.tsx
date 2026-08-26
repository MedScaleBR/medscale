import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { TeamClient } from '@/components/configuracoes/TeamClient'
import { OVERRIDABLE_MODULES } from '@/components/layout/NavLinks'
import type { ModuleSlug } from '@/types/database'

export default async function EquipePage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Convite/gestão de equipe é exclusivo do owner.
  if (session.role !== 'owner') redirect('/configuracoes')

  const supabase = await createClient()
  const [{ data: membershipsRaw }, { data: invitesRaw }] = await Promise.all([
    supabase
      .from('memberships')
      .select('id, user_id, role, status, module_overrides')
      .eq('account_id', session.accountId)
      .order('invited_at'),
    supabase
      .from('invites')
      .select('id, email, role, expires_at')
      .eq('account_id', session.accountId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])

  // profiles não tem FK direta com memberships.user_id (ambos referenciam
  // auth.users independentemente) — busca separada com o client admin, já
  // que a RLS de profiles só deixa cada um ler o próprio.
  const userIds = (membershipsRaw ?? []).map((m) => m.user_id)
  const admin = createAdminClient()
  const { data: profilesRaw } =
    userIds.length > 0 ? await admin.from('profiles').select('id, full_name, email').in('id', userIds) : { data: [] }
  const profilesById = new Map((profilesRaw ?? []).map((p) => [p.id, p]))

  const members = (membershipsRaw ?? []).map((m) => {
    const profile = profilesById.get(m.user_id)
    return {
      id: m.id,
      role: m.role,
      status: m.status,
      moduleOverrides: m.module_overrides as ModuleSlug[] | null,
      userName: profile?.full_name ?? 'Sem nome',
      userEmail: profile?.email ?? '—',
      isSelf: m.user_id === session.userId,
    }
  })

  const invites = (invitesRaw ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expired: new Date(i.expires_at) < new Date(),
  }))

  const availableModules = OVERRIDABLE_MODULES.filter((m) => session.accountModules.includes(m))

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Equipe</h1>
        <p className="text-sm text-gray-400">Convide pessoas e controle o que cada uma pode ver.</p>
      </div>

      <TeamClient initialMembers={members} initialInvites={invites} availableModules={availableModules} />
    </div>
  )
}
