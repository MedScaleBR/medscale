import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { parsePatientInsuranceInput } from '@/lib/billing/validation'
import type { Database } from '@/types/database'

type Params = { params: Promise<{ id: string }> }
type InsuranceInsert = Database['public']['Tables']['patient_insurances']['Insert']

const COLUMNS =
  'id, patient_id, insurer_id, card_number, plan_name, valid_until, is_primary, created_at, health_insurers(name)'

// Convênios do paciente — qualquer membro (a recepção cadastra ao agendar).
// A RLS limita à account e o trigger enforce_billing_account garante que
// paciente e operadora são da mesma account.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('patient_insurances')
    .select(COLUMNS)
    .eq('patient_id', id)
    .eq('account_id', session.accountId)
    .order('is_primary', { ascending: false })
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Só um convênio principal por paciente.
async function clearOtherPrimaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  patientId: string,
  keepId: string,
) {
  await supabase
    .from('patient_insurances')
    .update({ is_primary: false })
    .eq('patient_id', patientId)
    .neq('id', keepId)
    .eq('is_primary', true)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parsePatientInsuranceInput(await req.json(), false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('patient_insurances')
    .insert({ ...parsed.value, patient_id: id, account_id: session.accountId } as InsuranceInsert)
    .select(COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Essa carteirinha já está cadastrada para o paciente.' }, { status: 409 })
    }
    // Paciente/operadora de outra account (trigger) ou inexistente.
    return NextResponse.json({ error: 'Não foi possível salvar o convênio.' }, { status: 400 })
  }
  if (data.is_primary) await clearOtherPrimaries(supabase, id, data.id)
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  if (typeof body.insurance_id !== 'string') {
    return NextResponse.json({ error: 'insurance_id é obrigatório' }, { status: 400 })
  }
  const parsed = parsePatientInsuranceInput(body, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('patient_insurances')
    .update(parsed.value)
    .eq('id', body.insurance_id)
    .eq('patient_id', id)
    .eq('account_id', session.accountId)
    .select(COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Essa carteirinha já está cadastrada para o paciente.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Não foi possível salvar o convênio.' }, { status: 400 })
  }
  if (!data) return NextResponse.json({ error: 'Convênio não encontrado' }, { status: 404 })
  if (data.is_primary) await clearOtherPrimaries(supabase, id, data.id)
  return NextResponse.json(data)
}

// Consultas que usavam este convênio ficam com patient_insurance_id nulo (FK
// set null); guias já geradas guardam a carteirinha no snapshot.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const insuranceId = req.nextUrl.searchParams.get('insurance_id')
  if (!insuranceId) return NextResponse.json({ error: 'insurance_id é obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('patient_insurances')
    .delete()
    .eq('id', insuranceId)
    .eq('patient_id', id)
    .eq('account_id', session.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
