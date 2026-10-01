import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { parseProcedureInput } from '@/lib/billing/validation'
import type { Database } from '@/types/database'

type Params = { params: Promise<{ id: string }> }
type ProcedureInsert = Database['public']['Tables']['insurer_procedures']['Insert']

// Tabela TUSS da operadora. GET: qualquer membro (seletor da agenda, só
// ativos; owner/admin pode pedir ?all=1). Escrita: owner/admin.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  let query = supabase
    .from('insurer_procedures')
    .select('id, insurer_id, tuss_code, description, price_cents, guide_type, is_active')
    .eq('insurer_id', id)
    .eq('account_id', session.accountId)
    .order('description')
  if (!(req.nextUrl.searchParams.get('all') === '1' && session.role !== 'member')) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parseProcedureInput(await req.json(), false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  const { data: insurer } = await supabase
    .from('health_insurers')
    .select('id')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .maybeSingle()
  if (!insurer) return NextResponse.json({ error: 'Operadora não encontrada' }, { status: 404 })

  const { data, error } = await supabase
    .from('insurer_procedures')
    // account_id é sobrescrito pelo trigger enforce_billing_account com o da operadora.
    .insert({ ...parsed.value, insurer_id: id, account_id: session.accountId } as ProcedureInsert)
    .select('id, insurer_id, tuss_code, description, price_cents, guide_type, is_active')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Esse código TUSS já está na tabela desta operadora.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  if (typeof body.procedure_id !== 'string') {
    return NextResponse.json({ error: 'procedure_id é obrigatório' }, { status: 400 })
  }
  const parsed = parseProcedureInput(body, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('insurer_procedures')
    .update(parsed.value)
    .eq('id', body.procedure_id)
    .eq('insurer_id', id)
    .eq('account_id', session.accountId)
    .select('id, insurer_id, tuss_code, description, price_cents, guide_type, is_active')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Esse código TUSS já está na tabela desta operadora.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
  return NextResponse.json(data)
}

// Guias já geradas não são afetadas: o procedimento vive no snapshot.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const procedureId = req.nextUrl.searchParams.get('procedure_id')
  if (!procedureId) return NextResponse.json({ error: 'procedure_id é obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('insurer_procedures')
    .delete()
    .eq('id', procedureId)
    .eq('insurer_id', id)
    .eq('account_id', session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
