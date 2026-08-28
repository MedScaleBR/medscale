import { resolveActiveSession } from '@/lib/session/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileCalendar } from '@/lib/google/reconcile'
import { AgendaClient } from '@/components/agenda/AgendaClient'

export default async function AgendaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0)

  const { appointments, busyBlocks } = await reconcileCalendar(session.workspaceId, from, to)

  const supabase = await createClient()

  // Catálogo de procedimentos para o seletor do modal — só quando o ciclo de
  // receita está ativo.
  let procedures: { id: string; name: string; default_price: number }[] = []
  if (session.userModules.includes('revenue_cycle')) {
    const { data } = await supabase
      .from('procedure_catalog')
      .select('id, name, default_price')
      .eq('workspace_id', session.workspaceId)
      .eq('is_active', true)
      .order('name', { ascending: true })
    procedures = (data ?? []).map((p) => ({ ...p, default_price: Number(p.default_price) }))
  }

  // Convênios atendidos (para o seletor "Atendimento" do modal). Fonte: a mesma
  // lista que a Maria informa aos pacientes (bot_config.insurance_plans).
  const { data: botConfig } = await supabase
    .from('bot_config')
    .select('insurance_plans')
    .eq('workspace_id', session.workspaceId)
    .maybeSingle()
  const healthPlans = botConfig?.insurance_plans ?? []

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
        procedures={procedures}
        healthPlans={healthPlans}
      />
    </div>
  )
}
