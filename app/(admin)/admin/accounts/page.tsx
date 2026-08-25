import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AccountsTable } from '@/components/admin/AccountsTable'

export default async function AdminAccountsPage() {
  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, name, slug, plan, is_active, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-400">{accounts?.length ?? 0} clientes cadastrados</p>
        </div>
        <Link
          href="/admin/accounts/new"
          className={cn(buttonVariants(), 'gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]')}
        >
          <Plus className="h-4 w-4" />
          Nova account
        </Link>
      </div>

      <AccountsTable accounts={accounts ?? []} />
    </div>
  )
}
