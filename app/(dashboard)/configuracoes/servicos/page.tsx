import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { ServicesClient } from '@/components/configuracoes/servicos/ServicesClient'
import type { Procedure } from '@/components/configuracoes/servicos/ProcedureCatalog'

export default async function ServicosSettingsPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  // Serviços alimentam a Clara, a agenda e o ciclo de receita — owner/admin
  // (a API espelha isso, ver /api/procedures).
  if (session.role !== 'owner' && session.role !== 'admin') redirect('/configuracoes')

  const supabase = await createClient()
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('display_order')
  const workspaceList = workspaces ?? []

  const [{ data: procedures }, { data: botConfig }] = await Promise.all([
    supabase
      .from('procedure_catalog')
      .select('*')
      .in('workspace_id', workspaceList.map((w) => w.id))
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('bot_config')
      .select('payment_methods, pricing_info, exam_preparation')
      .eq('account_id', session.accountId)
      .maybeSingle(),
  ])

  const proceduresByWorkspace: Record<string, Procedure[]> = {}
  for (const p of procedures ?? []) (proceduresByWorkspace[p.workspace_id] ??= []).push(p)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/configuracoes" className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Configurações
        </Link>
        <h1 className="text-xl font-medium text-gray-900">Serviços</h1>
        <p className="text-sm text-gray-400">
          Procedimentos, preços, formas de pagamento e preparo — o que a Clara informa ao paciente.
        </p>
      </div>

      <ServicesClient
        workspaces={workspaceList}
        activeWorkspaceId={session.workspaceId}
        initialProceduresByWorkspace={proceduresByWorkspace}
        initialExtras={{
          payment_methods: botConfig?.payment_methods ?? [],
          pricing_info: botConfig?.pricing_info ?? '',
          exam_preparation: botConfig?.exam_preparation ?? '',
        }}
      />
    </div>
  )
}
