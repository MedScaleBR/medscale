import { resolveActiveSession } from '@/lib/session/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileAccountCalendars } from '@/lib/google/reconcile'
import { hasTissIdentity } from '@/lib/billing/insurer'
import { AgendaClient } from '@/components/agenda/AgendaClient'
import { INSURER_UNITS_SELECT, withWorkspaceIds } from '@/lib/billing/insurer-units'

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
    .select('id, name, accepts_private')
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('display_order')

  // Catálogo de procedimentos para o seletor do modal — por unidade (o preço
  // pode variar entre unidades). Só quando o ciclo de receita está ativo.
  const proceduresByWorkspace: Record<string, { id: string; name: string; default_price: number }[]> = {}
  if (session.userModules.includes('revenue_cycle')) {
    const { data } = await supabase
      .from('procedure_catalog')
      .select('id, name, default_price, workspace_id')
      .in('workspace_id', (workspaceRows ?? []).map((w) => w.id))
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

  // Convênios aceitos (seletor "Atendimento" do modal) — os ativos cadastrados
  // em Convênios. Com o módulo billing, o modal usa as operadoras (com id).
  const { data: insurerData } = await supabase
    .from('health_insurers')
    .select(`id, name, ans_registry, provider_code, ${INSURER_UNITS_SELECT}`)
    .eq('account_id', session.accountId)
    .eq('is_active', true)
    .order('name')
  const insurerRows = ((insurerData ?? []) as unknown as Parameters<typeof withWorkspaceIds>[0][])
    .map(withWorkspaceIds) as unknown as Array<{
    id: string
    name: string
    ans_registry: string | null
    provider_code: string | null
    workspace_ids: string[] | null
  }>
  const healthPlans = insurerRows.map((i) => i.name)
  // O que cada unidade aceita: o modal só oferece isso (a API confere de novo).
  const workspaces = (workspaceRows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    accepts_private: w.accepts_private,
    insurer_ids: insurerRows.filter((i) => !i.workspace_ids || i.workspace_ids.includes(w.id)).map((i) => i.id),
    health_plans: insurerRows.filter((i) => !i.workspace_ids || i.workspace_ids.includes(w.id)).map((i) => i.name),
  }))
  // Com billing, todos os convênios; os sem registro ANS/código do prestador
  // podem ser usados na consulta, mas não geram guia TISS (billable: false).
  const billingInsurers = session.accountModules.includes('billing')
    ? (insurerRows ?? []).map((i) => ({ id: i.id, name: i.name, billable: hasTissIdentity(i) }))
    : []

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
        billingInsurers={billingInsurers}
      />
    </div>
  )
}
