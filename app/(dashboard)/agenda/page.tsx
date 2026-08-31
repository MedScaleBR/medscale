import { resolveActiveSession } from '@/lib/session/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileAccountCalendars } from '@/lib/google/reconcile'
import { AgendaClient } from '@/components/agenda/AgendaClient'

export default async function AgendaPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0)

  // Agenda consolidada: todas as unidades da account de uma vez (cada consulta
  // e cada bloqueio carrega o workspace_id — a UI colore e filtra por unidade).
  const { appointments, busyBlocks } = await reconcileAccountCalendars(session.accountId, from, to)

  const supabase = await createClient()

  const { data: workspaceRows } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('display_order')
  const workspaces = workspaceRows ?? []

  // Catálogo de procedimentos para o seletor do modal — por unidade (o preço
  // pode variar entre unidades). Só quando o ciclo de receita está ativo.
  const proceduresByWorkspace: Record<string, { id: string; name: string; default_price: number }[]> = {}
  if (session.userModules.includes('revenue_cycle')) {
    const { data } = await supabase
      .from('procedure_catalog')
      .select('id, name, default_price, workspace_id')
      .in('workspace_id', workspaces.map((w) => w.id))
      .eq('is_active', true)
      .order('name', { ascending: true })
    for (const p of data ?? []) {
      ;(proceduresByWorkspace[p.workspace_id] ??= []).push({
        id: p.id,
        name: p.name,
        default_price: Number(p.default_price),
      })
    }
  }

  // Convênios atendidos (seletor "Atendimento" do modal). Config da Maria é
  // única por account (bot_config.insurance_plans).
  const { data: botConfig } = await supabase
    .from('bot_config')
    .select('insurance_plans')
    .eq('account_id', session.accountId)
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
        workspaces={workspaces}
        activeWorkspaceId={session.workspaceId}
        showTranscriptions={session.userModules.includes('transcriptions')}
        proceduresByWorkspace={proceduresByWorkspace}
        healthPlans={healthPlans}
      />
    </div>
  )
}
