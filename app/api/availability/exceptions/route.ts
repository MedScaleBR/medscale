import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceSession } from '@/lib/session/api'
import { datesInRange } from '@/lib/availability/blocked-ranges'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Um ano cobre férias e licenças; acima disso é quase sempre erro de digitação.
const MAX_RANGE_DAYS = 366

export async function GET(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const from = req.nextUrl.searchParams.get('from')

  let query = supabase.from('availability_exceptions').select('*').eq('workspace_id', session.workspaceId).order('date')
  if (from) query = query.gte('date', from)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const body = await req.json()
  if (!body.date || !body.type) {
    return NextResponse.json({ error: 'date e type são obrigatórios' }, { status: 400 })
  }

  const row = {
    workspace_id: session.workspaceId,
    doctor_id: session.userId,
    type: body.type,
    start_time: body.start_time ?? null,
    end_time: body.end_time ?? null,
    reason: body.reason ?? null,
  }

  // Período: grava um registro por dia, para que a disponibilidade e o bot
  // continuem lendo exceções dia a dia. Responde sempre com um array.
  if (body.end_date) {
    if (!ISO_DATE.test(body.date) || !ISO_DATE.test(body.end_date)) {
      return NextResponse.json({ error: 'Datas inválidas.' }, { status: 400 })
    }
    if (body.end_date < body.date) {
      return NextResponse.json({ error: 'A data final precisa ser igual ou posterior à inicial.' }, { status: 400 })
    }
    const dates = datesInRange(body.date, body.end_date)
    if (dates.length > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: 'O período pode ter no máximo 1 ano.' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await supabase
      .from('availability_exceptions')
      .select('date')
      .eq('workspace_id', session.workspaceId)
      .eq('type', body.type)
      .is('start_time', null)
      .gte('date', body.date)
      .lte('date', body.end_date)
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

    const alreadyBlocked = new Set((existing ?? []).map((e) => e.date))
    const missing = dates.filter((date) => !alreadyBlocked.has(date))
    if (missing.length === 0) return NextResponse.json([], { status: 201 })

    const { data, error } = await supabase
      .from('availability_exceptions')
      .insert(missing.map((date) => ({ ...row, date })))
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  }

  const { data, error } = await supabase
    .from('availability_exceptions')
    .insert({ ...row, date: body.date })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

/** Remove vários bloqueios de uma vez (um período inteiro). Body: { ids: string[] } */
export async function DELETE(req: NextRequest) {
  const result = await requireWorkspaceSession(req)
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids é obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('availability_exceptions')
    .delete()
    .in('id', ids)
    .eq('workspace_id', session.workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
