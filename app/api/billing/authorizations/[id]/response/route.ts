import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { authorizationRpcError, withReadGuard } from '@/lib/billing/authorizations/rpc-errors'
import { canRecordResponse } from '@/lib/billing/authorizations/status'
import { parseResponseBody } from '@/lib/billing/authorizations/validation'

// D6: resposta da operadora digitada (status, número na operadora, senha,
// datas e quantidades/valores autorizados). Sem parse de XML de resposta.
// R1: estado final aceita nova resposta (correção). Só owner/admin (P1).
export const POST = withReadGuard(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })

  // parseResponseBody rejeita item de outra autorização, item repetido e valor
  // autorizado em procedimento; a quantidade contra a solicitada é conferida aqui.
  const parsed = parseResponseBody(await req.json().catch(() => null), current.items)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = parsed.value

  const requested = new Map(current.items.map((i) => [i.id, i.quantity_requested]))
  for (const item of r.items) {
    const max = requested.get(item.id)
    if (item.quantity_authorized !== null && max !== undefined && item.quantity_authorized > max) {
      return NextResponse.json({ error: 'Quantidade autorizada maior que a solicitada.' }, { status: 400 })
    }
  }

  if (!canRecordResponse(current.authorization.status)) {
    return NextResponse.json({ error: 'A resposta só pode ser registrada depois do envio e fora de autorizações canceladas.' }, { status: 409 })
  }

  const { error } = await supabase.rpc('record_tiss_authorization_response', {
    p_id: id,
    p_expected_updated_at: r.expected_updated_at,
    p_status_code: r.status_code,
    p_operator_guide_number: r.operator_guide_number,
    p_password: r.password,
    p_authorization_date: r.authorization_date,
    p_password_valid_until: r.password_valid_until,
    p_items: r.items,
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
})
