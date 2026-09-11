import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner } from '@/lib/finance/api-guard'
import { attachBalances } from '@/lib/finance/reserves'
import type { FinanceEntryType } from '@/lib/finance/types'

// Reservas (dinheiro guardado) da conta. Exclusivo do owner — dado patrimonial
// não é estendido a admin/member, igual a finance_entries. O saldo nunca é
// coluna: vem somado dos movimentos por attachBalances.

// GET /api/finance/reservas?kind=pf — lista com saldo e histórico.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind = kindParam === 'pf' || kindParam === 'pj' ? (kindParam as FinanceEntryType) : null
  const includeArchived = req.nextUrl.searchParams.get('arquivadas') === '1'

  const supabase = await createClient()
  let q = supabase
    .from('finance_reserves')
    .select('*')
    .eq('account_id', g.session.accountId)
    .order('created_at', { ascending: true })
  if (kind) q = q.eq('kind', kind)
  if (!includeArchived) q = q.is('archived_at', null)

  const { data: reserves, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (reserves ?? []).map((r) => r.id)
  const { data: movements } = ids.length
    ? await supabase
        .from('finance_reserve_movements')
        .select('*')
        .in('reserve_id', ids)
        .order('occurred_at', { ascending: false })
    : { data: [] }

  return NextResponse.json({ reserves: attachBalances(reserves ?? [], movements ?? []) })
}

// POST /api/finance/reservas — cria uma caixinha.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })
  const kind: FinanceEntryType = b.kind === 'pj' ? 'pj' : 'pf'

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('finance_reserves')
    .insert({ account_id: g.session.accountId, kind, name })
    .select('id')
    .single()

  if (error) {
    // idx_finance_reserves_unique_name: duas caixinhas de mesmo nome tornariam
    // o fuzzy match do agente do WhatsApp ambíguo.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Já existe uma reserva com esse nome', code: 'name_taken' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ id: data.id }, { status: 201 })
}
