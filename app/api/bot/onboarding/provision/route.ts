import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { invalidateBotConfigCache } from '@/lib/bot/config'
import { requireWorkspaceSession } from '@/lib/session/api'

// Registra o pedido de número provisionado pela MedScale. Não há
// provisionamento automático via API — a MedScale ainda não é um BSP/Tech
// Provider da Meta, então este pedido é atendido manualmente pela equipe,
// que depois roda o mesmo fluxo de verify-meta com o número provisionado.
export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { display_name, desired_number, document } = await req.json()
  if (!display_name || !document) {
    return NextResponse.json({ error: 'display_name e document são obrigatórios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('bot_config')
    .upsert(
      {
        workspace_id: session.workspaceId,
        account_id: session.accountId,
        number_source: 'medscale',
        onboarding_step: 'provisioning',
        is_active: false,
        provisioning_request: { display_name, desired_number: desired_number ?? null, document },
      },
      { onConflict: 'workspace_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateBotConfigCache(session.workspaceId)

  return NextResponse.json(data, { status: 201 })
}
