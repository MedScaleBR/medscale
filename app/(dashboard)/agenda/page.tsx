import { resolveActiveSession } from '@/lib/session/server'
import { reconcileCalendar } from '@/lib/google/reconcile'
import { AgendaClient } from '@/components/agenda/AgendaClient'

export default async function AgendaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0)

  const { appointments, busyBlocks } = await reconcileCalendar(session.workspaceId, from, to)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-gray-900">Agenda</h1>
        <p className="text-sm text-gray-400">Clique em um horário vazio para criar uma consulta, ou em uma consulta existente para editar.</p>
      </div>
      <AgendaClient
        initialAppointments={appointments}
        initialBusyBlocks={busyBlocks}
        showTranscriptions={session.userModules.includes('transcriptions')}
      />
    </div>
  )
}
