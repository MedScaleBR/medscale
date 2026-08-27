import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, RevenuePaymentMethod } from '@/types/database'
import { summarizeRevenueEntries } from '@/lib/revenue/summary'

// Ciclo de receita pelo WhatsApp: casar "o João pagou a consulta das 14h" com
// uma consulta real de hoje e confirmar o recebimento. Sempre passa por
// confirmação explícita do owner antes de persistir (ver lib/finance/agent.ts).

type SupabaseAdmin = SupabaseClient<Database>

export interface AppointmentPaymentMatch {
  revenueEntryId: string
  patientName: string
  procedureName: string | null
  amount: number
  time: string | null // HH:mm em São Paulo
}

export function normalizeName(s: string): string {
  // ̀-ͯ = marcas diacríticas combinantes; remove acento sem depender
  // de \p{Diacritic} (unicode property escapes são ES2018, fora do target).
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function timeInSaoPaulo(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

// Consultas de hoje com receita ainda em aberto (pending/realized) nos
// workspaces ativos da account, filtradas por nome do paciente e, se houver
// ambiguidade, pelo horário mencionado.
export async function findTodayUnpaidByPatient(
  supabase: SupabaseAdmin,
  accountId: string,
  opts: { patient: string | null; time: string | null }
): Promise<AppointmentPaymentMatch[]> {
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const wsIds = (workspaces ?? []).map((w) => w.id)
  if (wsIds.length === 0) return []

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data } = await supabase
    .from('revenue_entries')
    .select('id, amount, procedure_name, appointments(scheduled_at, patient_name), patients(full_name)')
    .in('workspace_id', wsIds)
    .eq('due_date', today)
    .in('payment_status', ['pending', 'realized'])

  const rows = (data ?? []) as unknown as Array<{
    id: string
    amount: number | string
    procedure_name: string | null
    appointments: { scheduled_at: string; patient_name: string } | null
    patients: { full_name: string } | null
  }>

  let matches: AppointmentPaymentMatch[] = rows.map((r) => ({
    revenueEntryId: r.id,
    patientName: r.patients?.full_name ?? r.appointments?.patient_name ?? 'Paciente',
    procedureName: r.procedure_name,
    amount: Number(r.amount) || 0,
    time: timeInSaoPaulo(r.appointments?.scheduled_at),
  }))

  if (opts.patient) {
    const q = normalizeName(opts.patient)
    const qFirst = q.split(/\s+/)[0]
    matches = matches.filter((m) => {
      const name = normalizeName(m.patientName)
      return name.includes(q) || (qFirst.length >= 3 && name.split(/\s+/).includes(qFirst))
    })
  }

  if (opts.time && matches.length > 1) {
    const withTime = matches.filter((m) => m.time === opts.time)
    if (withTime.length > 0) matches = withTime
  }

  return matches
}

// Confirma o recebimento — move a entrada para paga. Retorna false se a
// entrada já não estava em aberto (corrida com a tela, por exemplo).
export async function confirmAppointmentPayment(
  supabase: SupabaseAdmin,
  revenueEntryId: string,
  method: RevenuePaymentMethod
): Promise<boolean> {
  const { data, error } = await supabase
    .from('revenue_entries')
    .update({
      payment_status: 'paid',
      status: 'confirmado',
      payment_method: method,
      paid_at: new Date().toISOString(),
    })
    .eq('id', revenueEntryId)
    .in('payment_status', ['pending', 'realized'])
    .select('id')
    .maybeSingle()

  return !error && !!data
}

// Totais de receita de hoje agregados por account (todos os workspaces
// ativos) — para a linha "Receita de hoje: X recebidos de Y realizados".
export async function summarizeAccountToday(
  supabase: SupabaseAdmin,
  accountId: string
): Promise<{ received: number; realized: number }> {
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const wsIds = (workspaces ?? []).map((w) => w.id)
  if (wsIds.length === 0) return { received: 0, realized: 0 }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data } = await supabase
    .from('revenue_entries')
    .select('amount, payment_status')
    .in('workspace_id', wsIds)
    .eq('due_date', today)

  const totals = summarizeRevenueEntries(
    (data ?? []) as Array<{ amount: number | string; payment_status: Database['public']['Tables']['revenue_entries']['Row']['payment_status'] }>
  )
  return { received: totals.received, realized: totals.realized }
}
