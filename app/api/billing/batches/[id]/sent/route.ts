import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { BATCH_COLUMNS } from '@/lib/billing/constants'
import { trackBillingBatchMarkedSent } from '@/lib/analytics/posthog-server'

// Owner/admin. Lote 'generated' → 'sent' (sent_at/sent_by) e guias 'batched'
// → 'sent', na mesma transação (mark_tiss_batch_sent, SECURITY INVOKER — a
// RLS de admin vale).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data: batch } = await supabase
    .from('tiss_batches')
    .select('id, status')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Lote não encontrado' }, { status: 404 })

  const { data: updated, error } = await supabase.rpc('mark_tiss_batch_sent', { p_batch_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'Só lotes gerados (e ainda não enviados) podem ser marcados.' }, { status: 409 })
  }

  await trackBillingBatchMarkedSent(session.userId, { account_id: session.accountId })

  const { data } = await supabase.from('tiss_batches').select(BATCH_COLUMNS).eq('id', id).single()
  return NextResponse.json(data)
}
