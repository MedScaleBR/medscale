import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { loadSuggestionContext } from '@/lib/finance/patrimonio-queries'
import { calculateSuggestions } from '@/lib/finance/suggestions'
import { monthKey } from '@/lib/finance/summary'
import { FinanceSuggestionsClient } from '@/components/finance/FinanceSuggestionsClient'

// Sugestões são 100% derivadas: nada é gravado além do descarte e das
// tolerâncias. Os dois lados (PF e PJ) vêm prontos para a aba trocar sem
// nova viagem ao banco.
export default async function FinanceSugestoesPage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const supabase = await createClient()
  const period = monthKey(new Date())

  const [pf, pj] = await Promise.all([
    loadSuggestionContext(supabase, session.accountId, period, 'pf'),
    loadSuggestionContext(supabase, session.accountId, period, 'pj'),
  ])

  return (
    <FinanceSuggestionsClient
      periodMonth={period}
      tolerance={pf.tolerance}
      suggestions={{ pf: calculateSuggestions(pf), pj: calculateSuggestions(pj) }}
    />
  )
}
