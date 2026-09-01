import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { buildProvisionPayload } from './default-categories'

// Provisiona (idempotente) a árvore de categorias da conta: seed curado +
// derivação das categorias que já aparecem em finance_entries + backfill do
// category_id dos lançamentos antigos. Barato quando já provisionada (a função
// Postgres só checa um count sob advisory lock). Chamada no server component
// de /finance e no agente do WhatsApp antes de ler a árvore.
export async function ensureFinanceCategories(
  client: SupabaseClient<Database>,
  accountId: string
): Promise<void> {
  const { error } = await client.rpc('provision_finance_categories', {
    p_account_id: accountId,
    p_tree: buildProvisionPayload() as unknown as Database['public']['Functions']['provision_finance_categories']['Args']['p_tree'],
  })
  if (error) throw new Error(error.message)
}
