import { redirect } from 'next/navigation'
import { resolveActiveSession } from '@/lib/session/server'
import { FinanceSectionNav } from '@/components/finance/FinanceSectionNav'

// Terceira camada do owner-only (as outras duas são a RLS e o guarda das
// rotas de API): sem sessão de owner nenhuma aba de /finance chega a
// renderizar, nem para admin/member de uma conta com o módulo ativo.
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')
  if (session.role !== 'owner') redirect('/dashboard')
  if (!session.accountModules.includes('finance')) redirect('/dashboard')

  return (
    <div className="flex flex-col gap-5">
      <FinanceSectionNav />
      {children}
    </div>
  )
}
