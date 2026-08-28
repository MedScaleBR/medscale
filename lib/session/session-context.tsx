'use client'

import { createContext, useContext } from 'react'
import type { MembershipRole, ModuleSlug } from '@/types/database'

// Identidade da sessão exposta ao client — o suficiente para os eventos de
// analytics (workspace_id + account_id em BaseProps) sem ter que passar props
// por cada page → client component. O layout do dashboard já resolve isso no
// server (resolveActiveSession) e injeta aqui.
export interface ClientSession {
  userId: string
  accountId: string
  accountName: string
  accountPlan: string
  accountModules: ModuleSlug[]
  workspaceId: string
  role: MembershipRole
}

const SessionContext = createContext<ClientSession | null>(null)

export function SessionProvider({
  value,
  children,
}: {
  value: ClientSession
  children: React.ReactNode
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): ClientSession {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession precisa estar dentro de <SessionProvider>')
  return ctx
}

// Só workspace_id + account_id, pronto para espalhar nas props dos eventos.
export function useAnalyticsBase(): { workspace_id: string; account_id: string } {
  const { workspaceId, accountId } = useSession()
  return { workspace_id: workspaceId, account_id: accountId }
}
