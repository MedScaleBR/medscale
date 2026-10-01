import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createBillingStorage } from '@/lib/billing/storage'
import { requireBilling } from '@/lib/billing/access'
import { trackBillingBatchDownloaded } from '@/lib/analytics/posthog-server'

const SIGNED_URL_TTL_SECONDS = 5 * 60

// Owner/admin. Devolve { url } assinada por 5 minutos — nunca o xml_path.
// O lote é lido com o client do usuário (RLS is_account_admin); só a
// assinatura usa o service_role, porque o bucket não tem policy de leitura.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data: batch } = await supabase
    .from('tiss_batches')
    .select('xml_path, batch_number, status')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!batch) return NextResponse.json({ error: 'Lote não encontrado' }, { status: 404 })
  if (!batch.xml_path) return NextResponse.json({ error: 'Lote com erro não tem XML' }, { status: 409 })

  const { data, error } = await createBillingStorage()
    .createSignedUrl(batch.xml_path, SIGNED_URL_TTL_SECONDS, { download: `lote-tiss-${batch.batch_number}.xml` })
  if (error || !data) return NextResponse.json({ error: 'Não foi possível gerar o link' }, { status: 500 })

  await trackBillingBatchDownloaded(session.userId, { account_id: session.accountId })
  return NextResponse.json({ url: data.signedUrl })
}
