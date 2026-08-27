import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

// Preferências do ciclo de receita (resumo diário, tolerância de
// inadimplência). Exclusivo do owner — dado financeiro, mesmo padrão de
// /api/revenue. Uma linha por workspace; PUT faz upsert.

const DEFAULTS = {
  daily_summary_enabled: true,
  daily_summary_hour: 20,
  daily_summary_only_with_activity: false,
  overdue_tolerance_days: 2,
}

function requireOwner(session: { role: string }) {
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Restrito ao owner da account' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('revenue_settings')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Sem linha ainda → devolve os defaults para a tela renderizar.
  return NextResponse.json(data ?? { workspace_id: session.workspaceId, ...DEFAULTS })
}

export async function PUT(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const body = await req.json()
  const hour = Number(body.daily_summary_hour ?? DEFAULTS.daily_summary_hour)
  const tolerance = Number(body.overdue_tolerance_days ?? DEFAULTS.overdue_tolerance_days)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: 'daily_summary_hour deve ser um inteiro entre 0 e 23' }, { status: 400 })
  }
  if (!Number.isInteger(tolerance) || tolerance < 0) {
    return NextResponse.json({ error: 'overdue_tolerance_days deve ser um inteiro >= 0' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('revenue_settings')
    .upsert(
      {
        workspace_id: session.workspaceId,
        account_id: session.accountId,
        daily_summary_enabled: Boolean(body.daily_summary_enabled ?? DEFAULTS.daily_summary_enabled),
        daily_summary_hour: hour,
        daily_summary_only_with_activity: Boolean(
          body.daily_summary_only_with_activity ?? DEFAULTS.daily_summary_only_with_activity
        ),
        overdue_tolerance_days: tolerance,
      },
      { onConflict: 'workspace_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
