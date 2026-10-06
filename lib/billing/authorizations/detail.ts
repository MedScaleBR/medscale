import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { AUTHORIZATION_COLUMNS, AUTHORIZATION_ITEM_COLUMNS, AUTHORIZATION_SUMMARY_COLUMNS } from './constants'
import { failIfRead } from './rpc-errors'
import type { AuthorizationDetail, AuthorizationItem, AuthorizationRow, AuthorizationSummary } from './types'

// Leitura com o client do usuário: a RLS garante owner/admin da account; o
// filtro de account repete a regra (padrão das rotas de faturamento).
export async function loadAuthorizationDetail(
  supabase: SupabaseClient<Database>,
  accountId: string,
  id: string,
): Promise<AuthorizationDetail | null> {
  const { data, error: rowError } = await supabase
    .from('tiss_authorizations')
    .select(AUTHORIZATION_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  failIfRead('autorização', rowError)
  if (!data) return null
  const authorization = data as unknown as AuthorizationRow

  const [{ data: items, error: itemsError }, { data: parent, error: parentError }, { data: children, error: childrenError }] = await Promise.all([
    supabase
      .from('tiss_authorization_items')
      .select(AUTHORIZATION_ITEM_COLUMNS)
      .eq('authorization_id', id)
      .order('position', { ascending: true }),
    authorization.parent_id
      ? supabase
          .from('tiss_authorizations')
          .select(AUTHORIZATION_SUMMARY_COLUMNS)
          .eq('id', authorization.parent_id)
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('tiss_authorizations')
      .select(AUTHORIZATION_SUMMARY_COLUMNS)
      .eq('parent_id', id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true }),
  ])

  failIfRead('itens', itemsError)
  failIfRead('guia de origem', parentError)
  failIfRead('anexos vinculados', childrenError)

  return {
    authorization,
    items: (items ?? []) as unknown as AuthorizationItem[],
    parent: (parent ?? null) as unknown as AuthorizationSummary | null,
    children: (children ?? []) as unknown as AuthorizationSummary[],
  }
}
