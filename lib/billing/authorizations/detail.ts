import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { AUTHORIZATION_COLUMNS, AUTHORIZATION_ITEM_COLUMNS, AUTHORIZATION_SUMMARY_COLUMNS } from './constants'
import type { AuthorizationDetail, AuthorizationItem, AuthorizationRow, AuthorizationSummary } from './types'

// Leitura com o client do usuário: a RLS garante owner/admin da account; o
// filtro de account repete a regra (padrão das rotas de faturamento).
export async function loadAuthorizationDetail(
  supabase: SupabaseClient<Database>,
  accountId: string,
  id: string,
): Promise<AuthorizationDetail | null> {
  const { data } = await supabase
    .from('tiss_authorizations')
    .select(AUTHORIZATION_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return null
  const authorization = data as unknown as AuthorizationRow

  const [{ data: items }, { data: parent }, { data: children }] = await Promise.all([
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
      : Promise.resolve({ data: null }),
    supabase
      .from('tiss_authorizations')
      .select(AUTHORIZATION_SUMMARY_COLUMNS)
      .eq('parent_id', id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true }),
  ])

  return {
    authorization,
    items: (items ?? []) as unknown as AuthorizationItem[],
    parent: (parent ?? null) as unknown as AuthorizationSummary | null,
    children: (children ?? []) as unknown as AuthorizationSummary[],
  }
}
