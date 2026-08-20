import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'campaigns')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ad_campaigns')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('period_start', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'campaigns')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const body = await req.json()
  if (!body.channel || !body.period_start || !body.period_end) {
    return NextResponse.json({ error: 'channel, period_start e period_end são obrigatórios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ad_campaigns')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      channel: body.channel,
      campaign_name: body.campaign_name ?? null,
      period_start: body.period_start,
      period_end: body.period_end,
      spend: body.spend ?? 0,
      impressions: body.impressions ?? 0,
      clicks: body.clicks ?? 0,
      leads: body.leads ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
