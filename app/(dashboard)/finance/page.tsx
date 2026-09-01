import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { FinanceClient } from '@/components/finance/FinanceClient'
import type { FinanceEntry } from '@/lib/finance/types'

// Quantos meses para trás o painel deixa navegar — limita o tamanho da
// query sem exigir paginação (lançamentos são poucos por mês, ver
// FinanceEntryTable).
const MONTHS_OF_HISTORY = 12

export default async function FinancePage() {
  const session = await resolveActiveSession()
  if (!session) redirect('/sem-acesso')

  // Painel exclusivo do owner — não abrir para admin, mesmo que o módulo
  // esteja ativo no account.
  if (session.role !== 'owner') redirect('/dashboard')
  if (!session.accountModules.includes('finance')) redirect('/dashboard')

  const supabase = await createClient()

  // Provisiona a árvore de categorias na primeira visita (idempotente).
  await ensureFinanceCategories(supabase, session.accountId)

  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - (MONTHS_OF_HISTORY - 1), 1).toISOString().split('T')[0]

  const [{ data: entries }, categoryTree, { data: workspaces }] = await Promise.all([
    supabase
      .from('finance_entries')
      .select('*')
      .eq('account_id', session.accountId)
      .gte('entry_date', cutoff)
      .order('entry_date', { ascending: false }),
    getFinanceCategoryTree(supabase, session.accountId, { includeArchived: true }),
    supabase
      .from('workspaces')
      .select('id, name')
      .eq('account_id', session.accountId)
      .eq('is_active', true)
      .order('display_order'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Financeiro</h1>
        <p className="text-sm text-gray-400">
          Lançamentos pessoais (PF) e da clínica (PJ) — pelo WhatsApp ou aqui na tela
        </p>
      </div>
      <FinanceClient
        initialEntries={(entries ?? []) as FinanceEntry[]}
        categoryTree={categoryTree}
        workspaces={workspaces ?? []}
      />
    </div>
  )
}
