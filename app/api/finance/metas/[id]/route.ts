import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readAmount } from '@/lib/finance/api-guard'

// Editar, concluir/reabrir, arquivar e excluir uma meta. Nada de status_calc
// aqui: o progresso é derivado na leitura (ver GET /api/finance/metas).

type GoalStatusValue = Database['public']['Tables']['finance_goals']['Row']['status']
const STATUSES: GoalStatusValue[] = ['active', 'completed', 'archived']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const supabase = await createClient()

  const { data: goal } = await supabase
    .from('finance_goals')
    .select('*')
    .eq('id', id)
    .eq('account_id', g.session.accountId)
    .maybeSingle()
  if (!goal) return NextResponse.json({ error: 'Meta não encontrada' }, { status: 404 })

  const patch: Database['public']['Tables']['finance_goals']['Update'] = {}

  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })
    patch.name = name
  }
  const nextMode = b.mode === undefined ? goal.mode : b.mode === 'auto' ? 'auto' : 'manual'
  if (b.mode !== undefined) patch.mode = nextMode

  if (b.target_amount !== undefined || b.mode !== undefined) {
    if (nextMode === 'manual') {
      const amount = b.target_amount !== undefined ? readAmount(b.target_amount) : goal.target_amount
      if (amount == null) {
        return NextResponse.json({ error: 'Valor da meta obrigatório', code: 'target_required' }, { status: 400 })
      }
      patch.target_amount = amount
    } else {
      // Virar automática limpa o alvo fixo: manter o número velho ao lado de um
      // alvo derivado confundiria a leitura da tela.
      patch.target_amount = null
    }
  }
  if (b.target_date !== undefined) patch.target_date = b.target_date ? String(b.target_date) : null
  if (b.months_of_expenses !== undefined) {
    const months = readAmount(b.months_of_expenses)
    if (months == null) {
      return NextResponse.json({ error: 'Meses inválidos', code: 'months_invalid' }, { status: 400 })
    }
    patch.months_of_expenses = months
  }
  if (b.linked_reserve_id !== undefined) {
    const reserveId = b.linked_reserve_id ? String(b.linked_reserve_id) : null
    if (reserveId) {
      const { data: reserve } = await supabase
        .from('finance_reserves')
        .select('id')
        .eq('id', reserveId)
        .eq('account_id', g.session.accountId)
        .maybeSingle()
      if (!reserve) {
        return NextResponse.json({ error: 'Reserva inválida', code: 'reserve_invalid' }, { status: 400 })
      }
    }
    patch.linked_reserve_id = reserveId
  }
  if (b.status !== undefined) {
    const status = String(b.status) as GoalStatusValue
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Status inválido', code: 'status_invalid' }, { status: 400 })
    }
    patch.status = status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const { error } = await supabase.from('finance_goals').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('finance_goals')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', g.session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Meta não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
