import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner } from '@/lib/finance/api-guard'

// Renomear, arquivar/desarquivar e excluir uma reserva. Mesmo guarda da rota
// coleção. `kind` não é editável: mudar o lado PF/PJ de uma caixinha com
// histórico moveria patrimônio de lugar sem rastro.

async function ownedReserve(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  id: string
) {
  const { data } = await supabase
    .from('finance_reserves')
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  return data
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const supabase = await createClient()
  if (!(await ownedReserve(supabase, g.session.accountId, id))) {
    return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
  }

  const b = await req.json().catch(() => ({}))
  const patch: Database['public']['Tables']['finance_reserves']['Update'] = {}

  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) return NextResponse.json({ error: 'Nome obrigatório', code: 'name_required' }, { status: 400 })
    patch.name = name
  }
  // archived: true arquiva agora, false desarquiva. O histórico de movimentos
  // fica intacto nos dois casos.
  if (b.archived !== undefined) {
    patch.archived_at = b.archived ? new Date().toISOString() : null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 })
  }

  const { error } = await supabase.from('finance_reserves').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Já existe uma reserva com esse nome', code: 'name_taken' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
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
  if (!(await ownedReserve(supabase, g.session.accountId, id))) {
    return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
  }

  // Reserva com histórico não se apaga: apagar levaria junto os movimentos
  // (FK cascade) e o dinheiro guardado sumiria do registro sem rastro. Quem
  // quer tirar da tela arquiva.
  const { count } = await supabase
    .from('finance_reserve_movements')
    .select('id', { count: 'exact', head: true })
    .eq('reserve_id', id)

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Reserva com movimentos — arquive em vez de excluir', code: 'has_movements' },
      { status: 409 }
    )
  }

  const { error } = await supabase.from('finance_reserves').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
