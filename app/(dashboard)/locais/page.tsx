import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { WorkspacesClient } from '@/components/locais/WorkspacesClient'

export default async function LocaisPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, slug, address, city, state, zip_code, is_active, is_default, display_order')
    .eq('account_id', session.accountId)
    .order('display_order')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Meus locais</h1>
        <p className="text-sm text-gray-400">Unidades/clínicas da sua conta MedScale.</p>
      </div>
      <WorkspacesClient
        initialWorkspaces={workspaces ?? []}
        canManage={session.role === 'owner' || session.role === 'admin'}
      />
    </div>
  )
}
