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

const formatBRL0 = (v: number) => `R$${Math.round(v).toLocaleString('pt-BR')}`

// Fechamento diário enviado no WhatsApp do owner (ver
// /api/cron/daily-revenue-summary). Pura — testada em tests/revenue.
export function buildDailySummaryMessage(opts: {
  dateLabel: string
  totals: RevenueTotals
  pendingPatients: { name: string; amount: number }[]
}): string {
  const { dateLabel, totals, pendingPatients } = opts
  const realizedCount = totals.counts.realized + totals.counts.paid
  const missedCount = totals.counts.cancelled

  const lines: (string | null)[] = [
    `📊 *Fechamento de hoje — ${dateLabel}*`,
    ``,
    `✅ Realizadas: ${realizedCount} ${realizedCount === 1 ? 'consulta' : 'consultas'} · ${formatBRL0(totals.realized)}`,
    `💰 Recebido: ${formatBRL0(totals.received)}`,
    totals.counts.realized > 0
      ? `⏳ Pendente: ${formatBRL0(totals.pending)} (${totals.counts.realized} ${
          totals.counts.realized === 1 ? 'consulta' : 'consultas'
        })`
      : null,
    missedCount > 0
      ? `❌ No-show/cancelado: ${missedCount} ${missedCount === 1 ? 'consulta' : 'consultas'}`
      : null,
  ]

  if (pendingPatients.length > 0) {
    lines.push(``, `Pacientes sem pagamento confirmado:`)
    for (const p of pendingPatients) lines.push(`· ${p.name} — ${formatBRL0(p.amount)}`)
  }

  return lines.filter((l) => l !== null).join('\n')
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
