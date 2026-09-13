import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { calculateInvestmentProjection } from '@/lib/finance/investments'
import { FinanceInvestmentsClient } from '@/components/finance/FinanceInvestmentsClient'
import type { FinanceInvestment } from '@/lib/finance/types'

export default async function FinanceInvestimentosPage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const supabase = await createClient()
  const { data } = await supabase
    .from('finance_investments')
    .select('*')
    .eq('account_id', session.accountId)
    .order('created_at', { ascending: false })

  const investments = (data ?? []) as FinanceInvestment[]

  // Projeção é sempre derivada na leitura, e volta null quando faltam taxa ou
  // data — a tela mostra "dados insuficientes" em vez de um número inventado.
  const rows = investments.map((investment) => ({
    investment,
    projection: calculateInvestmentProjection(investment),
  }))

  return <FinanceInvestmentsClient rows={rows} />
}
