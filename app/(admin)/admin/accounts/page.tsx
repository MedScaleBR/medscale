import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AccountsTable } from '@/components/admin/AccountsTable'
import { getAccountsOverview } from '@/lib/admin/accounts'

export default async function AdminAccountsPage() {
  const supabase = await createClient()
  const { rows, costTruncated, error } = await getAccountsOverview(supabase)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-400">
            {rows.length} {rows.length === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}
          </p>
        </div>
        <Link
          href="/admin/accounts/new"
          className={cn(
            buttonVariants({ size: 'lg' }),
            'gap-2 rounded-[10px] bg-[var(--cyan)] px-3.5 text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]'
          )}
        >
          <Plus className="h-4 w-4" />
          Nova account
        </Link>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
          Não foi possível carregar todos os dados das accounts. Alguns números podem estar zerados.
        </p>
      )}
      {costTruncated && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Muitos eventos de custo no período — os valores de custo 30d estão subestimados.
        </p>
      )}

      <AccountsTable accounts={rows} />
    </div>
  )
}
