'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { initPostHog } from '@/lib/analytics/posthog'
import { useSession } from '@/lib/session/session-context'

// Identifica o usuário logado no PostHog e agrupa por account (métricas por
// clínica). Renderiza dentro do <SessionProvider> no layout do dashboard.
// reset() no logout fica no Topbar.
export function PostHogIdentify({ email, name }: { email: string; name: string }) {
  const { userId, accountId, accountName, accountPlan, accountModules, workspaceId, role } =
    useSession()

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Efeitos de filho rodam antes dos de pai — garante o init aqui também.
    initPostHog()
    if (!posthog.__loaded) return

    posthog.identify(userId, {
      email,
      name,
      role,
      account_id: accountId,
      account_plan: accountPlan,
      workspace_id: workspaceId,
    })

    posthog.group('account', accountId, {
      name: accountName,
      plan: accountPlan,
      modules: accountModules,
    })
  }, [userId, accountId, accountName, accountPlan, accountModules, workspaceId, role, email, name])

  return null
}
