import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, RevenuePaymentStatus } from '@/types/database'

type SupabaseAdmin = SupabaseClient<Database>

export interface RevenueTotals {
  /** previsto = tudo que não foi cancelado/reembolsado (pending + realized + paid) */
  projected: number
  /** realizado = consultas que aconteceram (realized + paid) */
  realized: number
  /** recebido = pagamento confirmado (paid) */
  received: number
  /** pendente = realizado mas ainda sem pagamento (realized) */
  pending: number
  counts: Record<RevenuePaymentStatus, number>
}

interface EntryRow {
  amount: number | string
  payment_status: RevenuePaymentStatus
}

// Agrega uma lista de revenue_entries nos totais do ciclo. Pura — a query
// (janela de datas, workspace) fica com quem chama.
export function summarizeRevenueEntries(entries: EntryRow[]): RevenueTotals {
  const counts: Record<RevenuePaymentStatus, number> = {
    pending: 0,
    realized: 0,
    paid: 0,
    cancelled: 0,
    refunded: 0,
  }
  let projected = 0
  let realized = 0
  let received = 0
  let pending = 0

  for (const e of entries) {
    const amount = Number(e.amount) || 0
    counts[e.payment_status] = (counts[e.payment_status] ?? 0) + 1

    if (e.payment_status === 'cancelled' || e.payment_status === 'refunded') continue
    projected += amount
    if (e.payment_status === 'realized' || e.payment_status === 'paid') realized += amount
    if (e.payment_status === 'paid') received += amount
    if (e.payment_status === 'realized') pending += amount
  }

  return { projected, realized, received, pending, counts }
}

// Totais de um workspace numa janela de datas (due_date), lidos com o client
// admin — revenue_entries tem RLS exclusiva de owner. Só chamar depois de já
// ter checado que quem pediu é o owner.
export async function getRevenueTotals(
  supabase: SupabaseAdmin,
  workspaceId: string,
  fromDate: string,
  toDate: string
): Promise<RevenueTotals> {
  const { data } = await supabase
    .from('revenue_entries')
    .select('amount, payment_status')
    .eq('workspace_id', workspaceId)
    .gte('due_date', fromDate)
    .lte('due_date', toDate)

  return summarizeRevenueEntries((data ?? []) as EntryRow[])
}
