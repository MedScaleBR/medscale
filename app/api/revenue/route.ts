import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'

// Financeiro (Receita) é exclusivo do owner — mesmo padrão de finance
// (agente PF/PJ): admin/member não veem, mesmo com o módulo ativo no
// account ou liberado via module_overrides.
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
  const moduleCheck = requireModule(session, 'financial')
  if (moduleCheck) return moduleCheck
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('revenue_entries')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('entry_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'financial')
  if (moduleCheck) return moduleCheck
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const supabase = await createClient()
  const body = await req.json()
  if (!body.amount) {
    return NextResponse.json({ error: 'amount é obrigatório' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('revenue_entries')
    .insert({
      workspace_id: session.workspaceId,
      account_id: session.accountId,
      appointment_id: body.appointment_id ?? null,
      amount: body.amount,
      status: body.status ?? 'previsto',
      payment_method: body.payment_method ?? null,
      notes: body.notes ?? null,
      entry_date: body.entry_date ?? new Date().toISOString().split('T')[0],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
