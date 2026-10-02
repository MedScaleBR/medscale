import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule, requireRole } from '@/lib/session/api'

// Catálogo de procedimentos. Leitura: qualquer membro com o ciclo de receita
// (a /agenda usa no seletor). Escrita: owner/admin, sem depender de módulo —
// o catálogo alimenta a Clara em qualquer conta (página Serviços).

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const moduleCheck = requireModule(session, 'revenue_cycle')
  if (moduleCheck) return moduleCheck

  const supabase = await createClient()
  const includeInactive = req.nextUrl.searchParams.get('all') === '1'
  let query = supabase
    .from('procedure_catalog')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .order('name', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const roleCheck = requireRole(session, ['owner', 'admin'])
  if (roleCheck) return roleCheck

  const body = await req.json()
  const price = Number(body.default_price)
  if (!body.name || !Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'name e default_price (>= 0) são obrigatórios' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('procedure_catalog')
    .insert({
      workspace_id: session.workspaceId,
      name: String(body.name).trim(),
      code: body.code ? String(body.code).trim() : null,
      default_price: price,
      duration_min: body.duration_min != null ? Number(body.duration_min) : null,
      is_active: body.is_active ?? true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
