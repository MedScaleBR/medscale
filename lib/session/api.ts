import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from './server'
import { ALWAYS_ON_MODULES, type ModuleSlug } from './context'
import type { MembershipRole } from '@/types/database'

export interface ApiSession {
  userId: string
  accountId: string
  workspaceId: string
  role: MembershipRole
  modules: ModuleSlug[]
}

function mergeAlwaysOn(modules: ModuleSlug[]): ModuleSlug[] {
  return [...ALWAYS_ON_MODULES, ...modules.filter((m) => !ALWAYS_ON_MODULES.includes(m))]
}

// Resolve a sessão de API (usuário + workspace ativo) para uso em rotas.
// O workspace vem, em ordem de prioridade, do header `x-workspace-id`, da
// query `?workspace_id=`, ou da cookie `ms_workspace_id` (a mesma que
// switchWorkspace grava) — assim nenhum fetch() existente no frontend
// precisa passar o workspace explicitamente; header/query servem só como
// override pontual (ex: o dashboard consolidado consultando outro workspace).
export async function requireWorkspaceSession(
  req: NextRequest
): Promise<{ session: ApiSession } | { error: NextResponse }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let workspaceId =
    req.headers.get('x-workspace-id') ??
    req.nextUrl.searchParams.get('workspace_id') ??
    req.cookies.get('ms_workspace_id')?.value ??
    null

  if (!workspaceId) {
    // Sem override explícito (header/query) nem cookie de workspace — cai no
    // mesmo fallback usado pra renderizar a página (resolveActiveSession):
    // last_workspace_id, depois workspace padrão da account, depois a
    // primeira disponível. Sem isso, qualquer usuário que nunca trocou de
    // workspace manualmente pela UI (a maioria, já que a maior parte das
    // accounts tem só uma) cai aqui com erro mesmo tendo acesso normal.
    const fallback = await resolveActiveSession()
    workspaceId = fallback?.workspaceId ?? null
  }

  if (!workspaceId) {
    return { error: NextResponse.json({ error: 'Nenhuma workspace ativa. Selecione uma workspace.' }, { status: 400 }) }
  }

  // A policy de RLS de `workspaces` já exige acesso via my_workspace_ids() —
  // se a linha vier vazia, o usuário não tem acesso (ou ela não existe).
  const { data: workspace } = await supabase.from('workspaces').select('id, account_id').eq('id', workspaceId).single()

  if (!workspace) {
    return { error: NextResponse.json({ error: 'Workspace não encontrada ou sem acesso.' }, { status: 403 }) }
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('role, module_overrides, account:accounts(modules)')
    .eq('account_id', workspace.account_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  const typedMembership = membership as unknown as {
    role: MembershipRole
    module_overrides: ModuleSlug[] | null
    account: { modules: ModuleSlug[] }
  } | null

  if (!typedMembership) {
    return { error: NextResponse.json({ error: 'Sem acesso a esta account.' }, { status: 403 }) }
  }

  const accountModules = mergeAlwaysOn(typedMembership.account.modules)
  const modules = typedMembership.module_overrides
    ? mergeAlwaysOn(typedMembership.module_overrides.filter((m) => accountModules.includes(m)))
    : accountModules

  return {
    session: {
      userId: user.id,
      accountId: workspace.account_id,
      workspaceId: workspace.id,
      role: typedMembership.role,
      modules,
    },
  }
}

export function requireModule(session: ApiSession, module: ModuleSlug): NextResponse | null {
  if (!session.modules.includes(module)) {
    return NextResponse.json({ error: `Módulo '${module}' não está ativo no seu plano` }, { status: 403 })
  }
  return null
}
