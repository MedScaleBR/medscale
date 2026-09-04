import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { ensureFinanceCategories } from '@/lib/finance/provision'
import { getFinanceCategoryTree } from '@/lib/finance/categories'
import { normalizeCategoryName } from '@/lib/finance/default-categories'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'

type SupabaseAdmin = SupabaseClient<Database>

// Categoria-raiz PJ (direction 'in') que o espelho do ciclo de receita usa.
// Ver docs/superpowers/specs/2026-09-04-receita-espelho-financeiro-design.md.
export const REVENUE_MIRROR_CATEGORY = 'Consultas particulares'

export interface MirrorInput {
  id: string // revenue_entries.id
  accountId: string
  workspaceId: string
  amount: number
  procedureName: string | null
  paidAtIso: string | null // revenue_entries.paid_at
}

// Cria (idempotente) o finance_entry de entrada que espelha um pagamento de
// receita confirmado. Nunca lança — falha é logada e engolida, porque este
// espelho não pode derrubar a confirmação do pagamento que o disparou. Sem
// trigger no banco de propósito: o repo não tem harness de teste com
// Postgres real, então o ponto único de espelho é este helper TS, chamado
// pelos 3 sites que marcam payment_status = 'paid'.
export async function mirrorPaidRevenueToFinance(
  supabase: SupabaseAdmin,
  input: MirrorInput
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('finance_entries')
      .select('id')
      .eq('revenue_entry_id', input.id)
      .maybeSingle()
    if (existing) return

    await ensureFinanceCategories(supabase, input.accountId)
    const tree = await getFinanceCategoryTree(supabase, input.accountId)
    const target = normalizeCategoryName(REVENUE_MIRROR_CATEGORY)
    const cat = tree.pj.find((c) => c.direction === 'in' && normalizeCategoryName(c.name) === target)

    const entryDate = saoPauloDateOnly(input.paidAtIso ?? new Date().toISOString())

    const payload: Database['public']['Tables']['finance_entries']['Insert'] = {
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      recorded_by_phone: 'revenue-cycle',
      type: 'pj',
      direction: 'in',
      description: input.procedureName ?? 'Consulta',
      amount: input.amount,
      category: REVENUE_MIRROR_CATEGORY,
      category_id: cat?.id ?? null,
      subcategory_id: null,
      raw_message: '(ciclo de receita)',
      entry_date: entryDate,
      revenue_entry_id: input.id,
    }

    const { error } = await supabase.from('finance_entries').insert(payload)
    if (error) {
      console.error('[revenue-mirror] falha ao criar espelho do pagamento', {
        revenueEntryId: input.id,
        error: error.message,
      })
    }
  } catch (err) {
    console.error('[revenue-mirror] erro inesperado ao espelhar pagamento', {
      revenueEntryId: input.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Remove o espelho de uma revenue_entry (reembolso / correção de status).
// Sem call site hoje — a exclusão da revenue_entry já cascateia via FK
// (on delete cascade). Pronta para quando existir um fluxo de estorno.
export async function unmirrorPaidRevenue(
  supabase: SupabaseAdmin,
  revenueEntryId: string
): Promise<void> {
  const { error } = await supabase
    .from('finance_entries')
    .delete()
    .eq('revenue_entry_id', revenueEntryId)
  if (error) {
    console.error('[revenue-mirror] falha ao remover espelho', { revenueEntryId, error: error.message })
  }
}
