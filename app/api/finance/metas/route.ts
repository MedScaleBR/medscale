import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readAmount, readPeriodMonth } from '@/lib/finance/api-guard'
import { loadGoalContext } from '@/lib/finance/patrimonio-queries'
import { calculateGoalStatus } from '@/lib/finance/goals'
import { monthKey } from '@/lib/finance/summary'
import type { FinanceEntryType } from '@/lib/finance/types'

// Metas de poupança. O status (quanto falta, quanto por mês, progresso) nunca é
// coluna: calculateGoalStatus recalcula na leitura a partir das projeções e dos
// saldos do momento — é o que faz a meta automática acompanhar a realidade.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind = kindParam === 'pf' || kindParam === 'pj' ? (kindParam as FinanceEntryType) : null
  const period = (readPeriodMonth(req.nextUrl.searchParams.get('periodo')) ?? '').slice(0, 7)
    || monthKey(new Date())

  const supabase = await createClient()
  let q = supabase
    .from('finance_goals')
    .select('*')
    .eq('account_id', g.session.accountId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
  if (kind) q = q.eq('kind', kind)

  const [{ data, error }, ctx] = await Promise.all([
    q,
    loadGoalContext(supabase, g.session.accountId, period),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const goals = (data ?? []).map((goal) => ({ ...goal, status_calc: calculateGoalStatus(goal, ctx) }))
  return NextResponse.json({ goals })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })

  const mode = b.mode === 'auto' ? 'auto' : 'manual'
  // Meta manual precisa do alvo; a automática não aceita um, porque o alvo dela
  // vem das projeções e seria sobrescrito na leitura seguinte.
  const targetAmount = mode === 'manual' ? readAmount(b.target_amount) : null
  if (mode === 'manual' && targetAmount == null) {
    return NextResponse.json({ error: 'Valor da meta obrigatório', code: 'target_required' }, { status: 400 })
  }

  const months = mode === 'auto' ? readAmount(b.months_of_expenses) ?? 1 : 1

  const supabase = await createClient()
  if (b.linked_reserve_id) {
    const { data: reserve } = await supabase
      .from('finance_reserves')
      .select('id')
      .eq('id', String(b.linked_reserve_id))
      .eq('account_id', g.session.accountId)
      .maybeSingle()
    if (!reserve) {
      return NextResponse.json({ error: 'Reserva inválida', code: 'reserve_invalid' }, { status: 400 })
    }
  }

  const { data, error } = await supabase
    .from('finance_goals')
    .insert({
      account_id: g.session.accountId,
      kind: b.kind === 'pj' ? 'pj' : 'pf',
      name,
      mode,
      target_amount: targetAmount,
      target_date: b.target_date ? String(b.target_date) : null,
      months_of_expenses: months,
      linked_reserve_id: b.linked_reserve_id ? String(b.linked_reserve_id) : null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
