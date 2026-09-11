import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardFinanceOwner, readPeriodMonth } from '@/lib/finance/api-guard'
import { loadSuggestionContext } from '@/lib/finance/patrimonio-queries'
import { calculateSuggestions } from '@/lib/finance/suggestions'
import { monthKey } from '@/lib/finance/summary'
import type { FinanceEntryType } from '@/lib/finance/types'

// Alertas de gasto excessivo do mês. Tudo derivado: nada de sugestão gravada em
// tabela, porque ela muda assim que entra um lançamento ou uma projeção. O que
// persiste é só o descarte (finance_suggestion_dismissals).

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind: FinanceEntryType = kindParam === 'pj' ? 'pj' : 'pf'
  const period =
    (readPeriodMonth(req.nextUrl.searchParams.get('periodo')) ?? '').slice(0, 7) || monthKey(new Date())

  const supabase = await createClient()
  const ctx = await loadSuggestionContext(supabase, g.session.accountId, period, kind)

  return NextResponse.json({
    periodMonth: period,
    tolerance: ctx.tolerance,
    suggestions: calculateSuggestions(ctx),
  })
}

// PUT /api/finance/sugestoes — tolerâncias da conta (uma linha por account).
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const g = await guardFinanceOwner(req)
  if (g.error) return g.error

  const b = await req.json().catch(() => ({}))
  const read = (value: unknown): number | null => {
    const n = Number(value)
    return isFinite(n) && n >= 0 ? n : null
  }

  const projection = read(b.projection_tolerance_pct)
  const history = read(b.history_tolerance_pct)
  if (projection == null || history == null) {
    return NextResponse.json({ error: 'Tolerância inválida', code: 'tolerance_invalid' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('finance_suggestion_settings')
    .upsert(
      {
        account_id: g.session.accountId,
        projection_tolerance_pct: projection,
        history_tolerance_pct: history,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
