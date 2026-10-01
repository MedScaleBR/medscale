import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { BATCH_COLUMNS } from '@/lib/billing/constants'
import { createBatchesForInsurer, reportBatchFailure } from '@/lib/billing/batches'

// XML + validação XSD (xmllint-wasm) de até 100 guias por lote.
export const maxDuration = 60

// Owner/admin. ?insurer_id= filtra por operadora. xml_path nunca sai daqui.
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  let query = supabase
    .from('tiss_batches')
    .select(BATCH_COLUMNS)
    .eq('account_id', session.accountId)
    .order('created_at', { ascending: false })
    .limit(200)
  const insurerId = req.nextUrl.searchParams.get('insurer_id')
  if (insurerId) query = query.eq('insurer_id', insurerId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// "Gerar lote agora" — { insurer_id }. Mesmo caminho do cron.
export async function POST(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  if (typeof body.insurer_id !== 'string') {
    return NextResponse.json({ error: 'insurer_id é obrigatório' }, { status: 400 })
  }

  // A operadora é conferida com o client do usuário (RLS da account); a
  // geração usa o client admin porque o bucket tiss-batches não tem policy de
  // usuário e a numeração/fechamento são funções restritas ao service_role.
  const supabase = await createClient()
  const { data: insurer } = await supabase
    .from('health_insurers')
    .select('id, account_id, ans_registry, provider_code, tiss_version, max_guides_per_batch')
    .eq('id', body.insurer_id)
    .eq('account_id', session.accountId)
    .maybeSingle()
  if (!insurer) return NextResponse.json({ error: 'Operadora não encontrada' }, { status: 404 })

  try {
    const batches = await createBatchesForInsurer(createAdminClient(), insurer, { createdBy: session.userId })
    return NextResponse.json({ batches })
  } catch (err) {
    reportBatchFailure(err, { accountId: session.accountId, insurerId: insurer.id })
    return NextResponse.json({ error: 'Não foi possível gerar o lote. Tente novamente.' }, { status: 500 })
  }
}
