import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

async function requireMedscaleAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { supabase }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; workspaceId: string }> }) {
  const { id, workspaceId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const body = await req.json()

  if (body.is_default === true) {
    await supabase.from('workspaces').update({ is_default: false }).eq('account_id', id)
  }

  const update: WorkspaceUpdate = {}
  for (const field of ['name', 'address', 'city', 'state', 'zip_code', 'is_default', 'is_active'] as const) {
    if (field in body) update[field] = body[field]
  }

  const { data, error } = await supabase
    .from('workspaces')
    .update(update)
    .eq('id', workspaceId)
    .eq('account_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
