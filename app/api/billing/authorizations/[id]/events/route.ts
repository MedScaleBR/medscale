import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tiss_authorization_events')
    .select('id, event, from_status, to_status, actor_id, data, created_at')
    .eq('authorization_id', id)
    .eq('account_id', result.session.accountId)
    .order('id', { ascending: true })
  if (error) return NextResponse.json({ error: 'Não foi possível carregar o histórico.' }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
