import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { canCancel, canMarkSent } from '@/lib/billing/authorizations/status'
import { parseExpectedUpdatedAt } from '@/lib/billing/authorizations/validation'

// D3: ready → sent; cancelamento de draft até aguardando resposta. Só
// owner/admin (adminOnly, P1). O RPC repete tudo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const body: unknown = await req.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const to = record.to
  if (to !== 'sent' && to !== 'cancelled') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const at = parseExpectedUpdatedAt(record.expected_updated_at)
  if (!at.ok) return NextResponse.json({ error: at.error }, { status: 400 })

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  const { status } = current.authorization

  if (to === 'sent' && !canMarkSent(status)) {
    return NextResponse.json({ error: 'Só autorizações prontas podem ser marcadas como enviadas.' }, { status: 409 })
  }
  if (to === 'cancelled' && !canCancel(status)) {
    return NextResponse.json({ error: 'Esta autorização não pode mais ser cancelada.' }, { status: 409 })
  }

  const { error } = await supabase.rpc('transition_tiss_authorization', { p_id: id, p_to: to, p_expected_updated_at: at.value })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
