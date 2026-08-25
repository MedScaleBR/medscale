import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const { error } = await supabase.from('account_notes').delete().eq('id', noteId).eq('account_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
