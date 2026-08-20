import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import type { Database } from '@/types/database'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins do account podem editar unidades.' }, { status: 403 })
  }

  const supabase = await createClient()
  const body = await req.json()

  // Só pode existir uma workspace padrão por account — desmarca as outras antes
  if (body.is_default === true) {
    await supabase.from('workspaces').update({ is_default: false }).eq('account_id', session.accountId)
  }

  const update: WorkspaceUpdate = {}
  for (const field of ['name', 'address', 'city', 'state', 'zip_code', 'is_default', 'is_active'] as const) {
    if (field in body) update[field] = body[field]
  }

  const { data, error } = await supabase
    .from('workspaces')
    .update(update)
    .eq('id', id)
    .eq('account_id', session.accountId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
