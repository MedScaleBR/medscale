import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { RevenueSettingsClient } from '@/components/configuracoes/RevenueSettingsClient'

export default async function ReceitaSettingsPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Preferências do ciclo de receita: exclusivo do owner, e só com o módulo ativo.
  if (session.role !== 'owner' || !session.userModules.includes('revenue_cycle')) {
    redirect('/configuracoes')
  }

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('revenue_settings')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .maybeSingle()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Receita</h1>
        <p className="text-sm text-gray-400">
          Preferências do fechamento diário. O catálogo de procedimentos fica em{' '}
          <Link href="/configuracoes/servicos" className="text-[var(--cyan-dark)] hover:underline">
            Serviços
          </Link>
          .
        </p>
      </div>

      <RevenueSettingsClient
        initialSettings={
          settings ?? {
            daily_summary_enabled: true,
            daily_summary_hour: 20,
            daily_summary_only_with_activity: false,
            overdue_tolerance_days: 2,
          }
        }
      />
    </div>
  )
}
