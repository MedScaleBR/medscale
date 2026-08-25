import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', avancado: 'Avançado', premium: 'Premium' }

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

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {!accounts || accounts.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma account cadastrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Nome</th>
                <th className="px-5 py-3 font-normal">Plano</th>
                <th className="px-5 py-3 font-normal">Status</th>
                <th className="px-5 py-3 font-normal">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40">
                  <td className="px-5 py-3">
                    <Link href={`/admin/accounts/${a.id}`} className="font-medium text-gray-900 hover:text-[var(--cyan-dark)]">
                      {a.name}
                    </Link>
                    <p className="text-xs text-gray-400">{a.slug}</p>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{PLAN_LABEL[a.plan] ?? a.plan}</td>
                  <td className="px-5 py-3">
                    <Badge className={a.is_active ? 'border-none bg-green-50 text-green-700' : 'border-none bg-red-50 text-red-600'}>
                      {a.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{new Date(a.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
