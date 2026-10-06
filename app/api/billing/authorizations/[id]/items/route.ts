import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError, readOnlyConflict } from '@/lib/billing/authorizations/rpc-errors'
import { parseExpectedUpdatedAt, parseItems } from '@/lib/billing/authorizations/validation'

// Substitui todos os itens (procedimentos ou materiais OPME) numa transação,
// recalculando as pendências; só em draft/ready.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const body: unknown = await req.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const at = parseExpectedUpdatedAt(record.expected_updated_at)
  if (!at.ok) return NextResponse.json({ error: at.error }, { status: 400 })

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  const readOnly = readOnlyConflict(current.authorization.status)
  if (readOnly) return readOnly

  const items = parseItems(current.authorization.type, record.items)
  if (!items.ok) return NextResponse.json({ error: items.error }, { status: 400 })

  const { error } = await supabase.rpc('update_tiss_authorization', {
    p_id: id,
    p_expected_updated_at: at.value,
    p_payload: current.authorization.payload,
    p_missing_fields: computeAuthorizationMissing(current.authorization.payload, items.value.length),
    p_items: items.value,
    p_event: 'updated',
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
