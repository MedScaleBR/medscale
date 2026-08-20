import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { WaitlistClient } from '@/components/waitlist/WaitlistClient'

export default async function ListaEsperaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const { data: entries } = await supabase
    .from('waitlist')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Lista de espera</h1>
        <p className="text-sm text-gray-400">Pacientes aguardando uma vaga na agenda.</p>
      </div>
      <WaitlistClient initialEntries={entries ?? []} />
    </div>
  )
}
