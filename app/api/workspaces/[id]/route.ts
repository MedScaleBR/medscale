import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { parseProviderFields } from '@/lib/billing/validation'
import { parseOutsourcedFields } from '@/lib/outsourced/config'
import type { Database } from '@/types/database'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins do account podem editar unidades.' }, { status: 403 })
  }

  const supabase = await createClient()
  const body = await req.json()

  if (body.handoff_number && !/^\+\d{10,15}$/.test(body.handoff_number)) {
    return NextResponse.json(
      { error: 'Número de handoff inválido. Use o formato internacional: +5511999999999' },
      { status: 400 }
    )
  }

  const update: WorkspaceUpdate = {}
  for (const field of [
    'name',
    'address',
    'city',
    'state',
    'zip_code',
    'is_default',
    'is_active',
    // Campos que a Clara usa por unidade (ver bot_config para o que é por account).
    'business_hours',
    'directions_parking',
    'contact_info',
    'handoff_number',
  ] as const) {
    if (field in body) update[field] = body[field]
  }

  // Faturamento TISS: identificação do prestador (CNES, CNPJ, razão social).
  const provider = parseProviderFields(body)
  if (!provider.ok) return NextResponse.json({ error: provider.error }, { status: 400 })
  Object.assign(update, provider.value)

  // Agendamento terceirizado: valida contra o estado atual da unidade, mas só
  // consulta o banco quando o body mexe nesses campos.
  if ('is_outsourced' in body || 'external_clinic_phone' in body) {
    const { data: current } = await supabase
      .from('workspaces')
      .select('is_outsourced, external_clinic_phone')
      .eq('id', id)
      .eq('account_id', session.accountId)
      .maybeSingle()
    const outsourced = parseOutsourcedFields(body, {
      is_outsourced: current?.is_outsourced ?? false,
      external_clinic_phone: current?.external_clinic_phone ?? null,
    })
    if (!outsourced.ok) return NextResponse.json({ error: outsourced.error }, { status: 400 })
    Object.assign(update, outsourced.value)
  }

  // Só pode existir uma workspace padrão por account — desmarca as outras.
  // Fica depois das validações para um 400 não deixar a account sem padrão.
  if (body.is_default === true) {
    await supabase.from('workspaces').update({ is_default: false }).eq('account_id', session.accountId)
  }

  const { data, error } = await supabase
    .from('workspaces')
    .update(update)
    .eq('id', id)
    .eq('account_id', session.accountId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
