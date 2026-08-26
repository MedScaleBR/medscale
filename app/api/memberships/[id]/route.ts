import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { OVERRIDABLE_MODULES } from '@/components/layout/NavLinks'
import type { MembershipRole, ModuleSlug } from '@/types/database'

const ASSIGNABLE_ROLES: MembershipRole[] = ['admin', 'member']

function requireOwner(session: { role: string }) {
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Restrito ao owner da account' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const supabase = await createClient()

  const { data: membership } = await supabase
    .from('memberships')
    .select('id, user_id, role')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .single()

  if (!membership) return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 })
  if (membership.user_id === session.userId) {
    return NextResponse.json({ error: 'Não é possível editar sua própria permissão por aqui' }, { status: 400 })
  }

  const body = await req.json()
  const update: { role?: MembershipRole; module_overrides?: ModuleSlug[] | null } = {}

  if (body.role !== undefined) {
    if (!ASSIGNABLE_ROLES.includes(body.role)) {
      return NextResponse.json({ error: 'Papel deve ser admin ou member' }, { status: 400 })
    }
    if (membership.role === 'owner') {
      return NextResponse.json({ error: 'Não é possível alterar o papel de outro owner por aqui' }, { status: 400 })
    }
    update.role = body.role
  }

  if (body.module_overrides !== undefined) {
    if (body.module_overrides !== null) {
      if (!Array.isArray(body.module_overrides) || !body.module_overrides.every((m: unknown) => OVERRIDABLE_MODULES.includes(m as ModuleSlug))) {
        return NextResponse.json({ error: 'module_overrides inválido' }, { status: 400 })
      }
    }
    update.module_overrides = body.module_overrides
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('memberships')
    .update(update)
    .eq('id', id)
    .eq('account_id', session.accountId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result
  const ownerCheck = requireOwner(session)
  if (ownerCheck) return ownerCheck

  const supabase = await createClient()

  const { data: membership } = await supabase
    .from('memberships')
    .select('id, user_id, role')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .single()

  if (!membership) return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 })
  if (membership.user_id === session.userId) {
    return NextResponse.json({ error: 'Não é possível remover a si mesmo' }, { status: 400 })
  }
  if (membership.role === 'owner') {
    return NextResponse.json({ error: 'Não é possível remover outro owner por aqui' }, { status: 400 })
  }

  const { error } = await supabase.from('memberships').delete().eq('id', id).eq('account_id', session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
