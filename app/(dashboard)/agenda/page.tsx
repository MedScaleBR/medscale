import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { AgendaClient } from '@/components/agenda/AgendaClient'

export default async function AgendaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const supabase = await createClient()
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString()

  const { data: appointments } = await supabase
    .from('appointments')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .gte('scheduled_at', from)
    .lte('scheduled_at', to)
    .order('scheduled_at')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Agenda</h1>
        <p className="text-sm text-gray-400">Clique em um horário vazio para criar uma consulta, ou em uma consulta existente para editar.</p>
      </div>
      <AgendaClient initialAppointments={appointments ?? []} />
    </div>
  )
}
