import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { buildProvisionPayload } from './default-categories'

// Janela deploy-antes-da-migration: a função ainda não existe no banco. Trata
// como "ainda não provisionada" em vez de derrubar /finance (server
// component) ou engolir a resposta do agente no webhook do WhatsApp.
function isFunctionMissing(error: unknown): boolean {
  const code = (error as { code?: string }).code
  const msg = ((error as { message?: string }).message ?? '').toLowerCase()
  return code === '42883' || msg.includes('does not exist') || msg.includes('could not find')
}

// Provisiona (idempotente) a árvore de categorias da conta: seed curado +
// derivação das categorias que já aparecem em finance_entries + backfill do
// category_id dos lançamentos antigos. Barato quando já provisionada (a função
// Postgres só checa um count sob advisory lock). Também garante o seed das
// categorias-raiz de RECEITA (direction 'in') — separado porque o RPC acima
// tem sua própria guarda "se já há qualquer categoria, retorna", que não
// cobre uma conta que só provisionou despesa antes deste seed existir. Chamada
// no server component de /finance, no agente do WhatsApp e no espelho do
// ciclo de receita (lib/revenue/finance-mirror.ts), sempre antes de ler a árvore.
export async function ensureFinanceCategories(
  client: SupabaseClient<Database>,
  accountId: string
): Promise<void> {
  const provision = await client.rpc('provision_finance_categories', {
    p_account_id: accountId,
    p_tree: buildProvisionPayload() as unknown as Database['public']['Functions']['provision_finance_categories']['Args']['p_tree'],
  })
  if (provision.error) {
    if (!isFunctionMissing(provision.error)) {
      throw new Error((provision.error as { message?: string }).message ?? 'Erro ao provisionar categorias')
    }
    console.warn(
      '[finance] provision_finance_categories ainda não existe no banco (migration pendente); seguindo sem provisionar categorias.'
    )
  }

  const seed = await client.rpc('ensure_finance_income_seed', { p_account_id: accountId })
  if (seed.error) {
    if (!isFunctionMissing(seed.error)) {
      throw new Error((seed.error as { message?: string }).message ?? 'Erro ao semear categorias de receita')
    }
    console.warn(
      '[finance] ensure_finance_income_seed ainda não existe no banco (migration pendente); seguindo sem semear categorias de receita.'
    )
  }
}
