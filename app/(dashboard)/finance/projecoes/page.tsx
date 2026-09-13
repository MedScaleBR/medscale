import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { monthKey } from '@/lib/finance/summary'
import { FinanceProjectionsClient } from '@/components/finance/FinanceProjectionsClient'
import type { FinanceEntry, FinanceProjection } from '@/lib/finance/types'

// A tela abre no mês corrente; a navegação entre meses recarrega via query
// string (?periodo=YYYY-MM) para não manter 12 meses de lançamento em memória.
export default async function FinanceProjecoesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const { periodo } = await searchParams
  const period = /^\d{4}-\d{2}$/.test(periodo ?? '') ? (periodo as string) : monthKey(new Date())

  const supabase = await createClient()
  const [tree, { data: projections }, { data: entries }] = await Promise.all([
    getFinanceCategoryTree(supabase, session.accountId),
    supabase
      .from('finance_projections')
      .select('*')
      .eq('account_id', session.accountId)
      .eq('period_month', `${period}-01`),
    supabase
      .from('finance_entries')
      .select('*')
      .eq('account_id', session.accountId)
      .eq('direction', 'out')
      .gte('entry_date', `${period}-01`)
      .lte('entry_date', `${period}-31`),
  ])

  return (
    <FinanceProjectionsClient
      period={period}
      tree={tree}
      projections={(projections ?? []) as FinanceProjection[]}
      entries={(entries ?? []) as FinanceEntry[]}
    />
  )
}
