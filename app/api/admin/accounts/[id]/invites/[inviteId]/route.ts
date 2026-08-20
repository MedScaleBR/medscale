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

// Cancela um convite pendente (ainda não aceito) — libera o e-mail para
// receber um novo convite.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  const { id, inviteId } = await params
  const result = await requireMedscaleAdmin()
  if ('error' in result) return result.error
  const { supabase } = result

  const { error } = await supabase
    .from('invites')
    .delete()
    .eq('id', inviteId)
    .eq('account_id', id)
    .is('accepted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
