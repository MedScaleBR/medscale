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
  if (!error) return

  // Janela deploy-antes-da-migration: a função ainda não existe no banco.
  // Trata como "ainda não provisionada" e degrada em vez de derrubar /finance
  // (server component) ou engolir a resposta do agente no webhook do WhatsApp.
  // getFinanceCategoryTree devolve árvores vazias e as telas seguem.
  const code = (error as { code?: string }).code
  const msg = ((error as { message?: string }).message ?? '').toLowerCase()
  const functionMissing =
    code === '42883' ||
    (msg.includes('provision_finance_categories') &&
      (msg.includes('does not exist') || msg.includes('could not find')))
  if (functionMissing) {
    console.warn(
      '[finance] provision_finance_categories ainda não existe no banco (migration pendente); seguindo sem provisionar categorias.'
    )
    return
  }

  throw new Error((error as { message?: string }).message ?? 'Erro ao provisionar categorias')
}
