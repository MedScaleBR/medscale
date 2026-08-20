import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ALWAYS_ON_MODULES, type ActiveSession, type AccountSummary, type ModuleSlug } from './context'

interface MembershipRow {
  role: 'owner' | 'admin' | 'member'
  module_overrides: ModuleSlug[] | null
  workspace_ids: string[] | null
  account: {
    id: string
    name: string
    modules: ModuleSlug[]
    is_active: boolean
    workspaces: Array<{ id: string; name: string; is_default: boolean; is_active: boolean; display_order: number }>
  }
}

function mergeAlwaysOn(modules: ModuleSlug[]): ModuleSlug[] {
  return [...ALWAYS_ON_MODULES, ...modules.filter((m) => !ALWAYS_ON_MODULES.includes(m))]
}

// Resolve a account + workspace ativos do usuário logado, a partir das
// cookies `ms_account_id`/`ms_workspace_id` (gravadas por switchAccount/
// switchWorkspace) com fallback para profiles.last_workspace_id, depois o
// workspace padrão da account, depois o primeiro disponível.
export async function resolveActiveSession(): Promise<ActiveSession | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const cookieStore = await cookies()
  const savedAccountId = cookieStore.get('ms_account_id')?.value
  const savedWorkspaceId = cookieStore.get('ms_workspace_id')?.value

  const [{ data: membershipsRaw }, { data: profile }] = await Promise.all([
    supabase
      .from('memberships')
      .select(
        `
        role,
        module_overrides,
        workspace_ids,
        account:accounts (
          id, name, modules, is_active,
          workspaces (id, name, is_default, is_active, display_order)
        )
      `
      )
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('invited_at'),
    supabase.from('profiles').select('last_workspace_id').eq('id', user.id).single(),
  ])

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[]
  if (memberships.length === 0) return null

  const membership = memberships.find((m) => m.account.id === savedAccountId) ?? memberships[0]
  const { account } = membership
  if (!account.is_active) return null

  const allWorkspaces = account.workspaces
    .filter((w) => w.is_active)
    .filter((w) => !membership.workspace_ids || membership.workspace_ids.includes(w.id))
    .sort((a, b) => a.display_order - b.display_order)

  if (allWorkspaces.length === 0) return null

  const activeWorkspace =
    allWorkspaces.find((w) => w.id === savedWorkspaceId) ??
    allWorkspaces.find((w) => w.id === profile?.last_workspace_id) ??
    allWorkspaces.find((w) => w.is_default) ??
    allWorkspaces[0]

  const accountModules = mergeAlwaysOn(account.modules)
  const userModules = membership.module_overrides
    ? mergeAlwaysOn(membership.module_overrides.filter((m) => accountModules.includes(m)))
    : accountModules

  return {
    userId: user.id,
    accountId: account.id,
    accountName: account.name,
    accountModules,
    workspaceId: activeWorkspace.id,
    workspaceName: activeWorkspace.name,
    allWorkspaces: allWorkspaces.map((w) => ({ id: w.id, name: w.name, isDefault: w.is_default })),
    role: membership.role,
    userModules,
  }
}

// Todas as accounts (ativas) em que o usuário logado é membro — usado pelo AccountSwitcher.
export async function listMyAccounts(): Promise<AccountSummary[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('memberships')
    .select('role, account:accounts(id, name, is_active)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('invited_at')

  type Row = { role: 'owner' | 'admin' | 'member'; account: { id: string; name: string; is_active: boolean } }
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.account.is_active)
    .map((r) => ({ id: r.account.id, name: r.account.name, role: r.role }))
}
