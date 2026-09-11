import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { loadReserves } from '@/lib/finance/patrimonio-queries'
import { FinanceReservesClient } from '@/components/finance/FinanceReservesClient'

// O guarda owner-only está no layout.tsx da seção — o redirect aqui só cobre
// a sessão sumindo entre o layout e a página.
export default async function FinanceReservasPage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  const supabase = await createClient()

  // Arquivadas vêm juntas: a tela esconde por padrão, mas desarquivar sem
  // recarregar a página depende de já ter a lista.
  const reserves = await loadReserves(supabase, session.accountId, { includeArchived: true })

  return <FinanceReservesClient reserves={reserves} />
}
