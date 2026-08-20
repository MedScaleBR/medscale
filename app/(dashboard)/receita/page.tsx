import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { RevenueClient } from '@/components/receita/RevenueClient'

export default async function ReceitaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: entries } = await supabase
    .from('revenue_entries')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('entry_date', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Receita</h1>
        <p className="text-sm text-gray-400">Entradas confirmadas e previstas</p>
      </div>
      <RevenueClient initialEntries={entries ?? []} />
    </div>
  )
}
