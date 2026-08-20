import type { MembershipRole, ModuleSlug } from '@/types/database'

export type { ModuleSlug }

// Sempre tratados como ativos, independente do que a account/membership configurar.
export const ALWAYS_ON_MODULES: ModuleSlug[] = ['dashboard', 'patients', 'settings']

export interface WorkspaceSummary {
  id: string
  name: string
  isDefault: boolean
}

export interface ActiveSession {
  userId: string
  accountId: string
  accountName: string
  accountModules: ModuleSlug[] // módulos ativos do account (inclui os sempre-ativos)
  workspaceId: string // workspace selecionado no momento
  workspaceName: string
  allWorkspaces: WorkspaceSummary[] // todos que o usuário pode acessar neste account
  role: MembershipRole
  userModules: ModuleSlug[] // módulos que este usuário específico pode ver
}

export interface AccountSummary {
  id: string
  name: string
  role: MembershipRole
}
