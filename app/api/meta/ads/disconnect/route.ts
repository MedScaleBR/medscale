import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireRole } from '@/lib/session/api'

export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  // Mesmo critério do connect: conexão única por account, afeta os
  // anúncios de todas as unidades.
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  // meta_ads_connections e workspace_ad_accounts só têm policy de SELECT
  // (migration_meta_integrations.sql) — igual exchangeAdsCodeAndSave, o
  // DELETE precisa do client admin; com o client comum (RLS) apagaria 0
  // linhas em silêncio (a checagem de role acima já autorizou a operação).
  const supabase = createAdminClient()

  const { error: connError } = await supabase
    .from('meta_ads_connections')
    .delete()
    .eq('account_id', session.accountId)
  if (connError) return NextResponse.json({ error: connError.message }, { status: 500 })

  // Sem conexão, os mapeamentos unidade → conta de anúncio ficam órfãos.
  const { error: mapError } = await supabase
    .from('workspace_ad_accounts')
    .delete()
    .eq('account_id', session.accountId)
  if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
