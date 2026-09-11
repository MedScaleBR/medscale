import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { loadGoalContext, loadReserves } from '@/lib/finance/patrimonio-queries'
import { calculateGoalStatus } from '@/lib/finance/goals'
import { monthKey } from '@/lib/finance/summary'
import { FinanceGoalsClient } from '@/components/finance/FinanceGoalsClient'
import type { FinanceGoal } from '@/lib/finance/types'

export default async function FinanceMetasPage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const supabase = await createClient()
  const period = monthKey(new Date())

  const [{ data }, ctx, reserves] = await Promise.all([
    supabase
      .from('finance_goals')
      .select('*')
      .eq('account_id', session.accountId)
      .neq('status', 'archived')
      .order('created_at', { ascending: true }),
    loadGoalContext(supabase, session.accountId, period),
    loadReserves(supabase, session.accountId),
  ])

  // Status recalculado a cada leitura — meta automática acompanha as projeções
  // e os saldos de agora, nunca um número congelado no banco.
  const goals = ((data ?? []) as FinanceGoal[]).map((goal) => ({
    goal,
    status: calculateGoalStatus(goal, ctx),
  }))

  return (
    <FinanceGoalsClient
      goals={goals}
      reserves={reserves.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
    />
  )
}
