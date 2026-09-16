import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'
import { getValidAdsToken, markAdsConnectionInvalid } from '@/lib/meta/ads-oauth'
import { graphFetch, MetaApiError } from '@/lib/meta/graph'

const NO_CONNECTION = 'Conecte sua conta do Facebook primeiro.'
const EXPIRED = 'Sua conexão com o Facebook expirou. Reconecte nas configurações.'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const token = await getValidAdsToken(session.accountId)
  if (!token) return NextResponse.json({ error: NO_CONNECTION }, { status: 409 })

  try {
    const data = await graphFetch<{ data: { account_id: string; name: string }[] }>('/me/adaccounts', {
      token,
      params: { fields: 'account_id,name', limit: '200' },
    })
    return NextResponse.json({
      adAccounts: (data.data ?? []).map((a) => ({ id: `act_${a.account_id}`, name: a.name })),
    })
  } catch (err) {
    if (err instanceof MetaApiError && err.isTokenExpired) {
      await markAdsConnectionInvalid(session.accountId)
      return NextResponse.json({ error: EXPIRED }, { status: 409 })
    }
    return NextResponse.json(
      { error: `Não foi possível listar suas contas de anúncio: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    )
  }
}

export async function PUT(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const { workspace_id, ad_account_id, ad_account_name } = await req.json()
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id é obrigatório' }, { status: 400 })

  const supabase = await createClient()

  // A unidade precisa ser da account da sessão — sem isso o usuário poderia
  // mapear a conta de anúncio dele numa unidade de outra clínica. `workspace_id`
  // vem do body (controlado pelo chamador); account_id vem da sessão.
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspace_id)
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!workspace) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  // workspace_ad_accounts só tem policy de SELECT (migration_meta_integrations.sql)
  // — igual ao disconnect (Task 8), delete/insert exigem o client admin; com o
  // client comum (RLS) essas operações afetariam 0 linhas em silêncio.
  const admin = createAdminClient()

  // Uma conta de anúncio por unidade na UI: limpa o vínculo anterior antes.
  await admin.from('workspace_ad_accounts').delete().eq('workspace_id', workspace_id)

  if (!ad_account_id) return NextResponse.json({ ok: true, adAccountId: null })

  const { error } = await admin.from('workspace_ad_accounts').insert({
    workspace_id,
    account_id: session.accountId,
    ad_account_id,
    ad_account_name: ad_account_name ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, adAccountId: ad_account_id })
}
