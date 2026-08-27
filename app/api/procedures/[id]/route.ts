import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession, requireModule } from '@/lib/session/api'
import type { Database } from '@/types/database'

type ProcedurePatch = Database['public']['Tables']['procedure_catalog']['Update']

// Edição/remoção de procedimento do catálogo — exclusiva do owner.
// A remoção é lógica (is_active = false): appointments e revenue_entries
// antigos referenciam o procedimento e os snapshots de nome/preço já foram
// gravados neles, mas manter a linha preserva a integridade do histórico.

function requireOwnerWithModule(req: NextRequest) {
  return requireWorkspaceSession(req).then((result) => {
    if ('error' in result) return { error: result.error }
    const moduleCheck = requireModule(result.session, 'revenue_cycle')
    if (moduleCheck) return { error: moduleCheck }
    if (result.session.role !== 'owner') {
      return { error: NextResponse.json({ error: 'Restrito ao owner da account' }, { status: 403 }) }
    }
    return { session: result.session }
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireOwnerWithModule(req)
  if ('error' in auth) return auth.error
  const { session } = auth

  const body = await req.json()
  const patch: ProcedurePatch = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.code !== undefined) patch.code = body.code ? String(body.code).trim() : null
  if (body.default_price !== undefined) {
    const price = Number(body.default_price)
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'default_price inválido' }, { status: 400 })
    }
    patch.default_price = price
  }
  if (body.duration_min !== undefined) patch.duration_min = body.duration_min != null ? Number(body.duration_min) : null
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('procedure_catalog')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireOwnerWithModule(req)
  if ('error' in auth) return auth.error
  const { session } = auth

  const supabase = await createClient()
  const { error } = await supabase
    .from('procedure_catalog')
    .update({ is_active: false })
    .eq('id', id)
    .eq('workspace_id', session.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
