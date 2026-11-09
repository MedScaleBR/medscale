import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { parseProviderFields } from '@/lib/billing/validation'
import { parseBookingOpenUntil } from '@/lib/scheduling/booking-window'
import {
  isOutsourcedWorkspace,
  OUTSOURCED_DISABLE_WITH_PENDING_ERROR,
  parseOutsourcedFields,
} from '@/lib/outsourced/config'
import { PENDING_EXTERNAL_STATUS, type Database } from '@/types/database'
import {
  ARCHIVE_BLOCKING_STATUSES,
  ARCHIVE_LAST_UNIT_ERROR,
  ARCHIVE_NOT_FOUND_ERROR,
  archivedSlug,
  archiveFutureAppointmentsError,
} from '@/lib/workspaces/archive'

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

  // Atende particular nesta unidade (tela de Convênios) — Clara e Agenda respeitam.
  if ('accepts_private' in body) {
    if (typeof body.accepts_private !== 'boolean') {
      return NextResponse.json({ error: 'accepts_private deve ser verdadeiro ou falso.' }, { status: 400 })
    }
    update.accepts_private = body.accepts_private
  }

  // Agenda aberta até: a Clara não oferece nem marca horário depois dessa data.
  if ('booking_open_until' in body) {
    const openUntil = parseBookingOpenUntil(body.booking_open_until)
    if (!openUntil.ok) return NextResponse.json({ error: openUntil.error }, { status: 400 })
    update.booking_open_until = openUntil.value
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
    const currentFlags = {
      is_outsourced: current?.is_outsourced ?? false,
      external_clinic_phone: current?.external_clinic_phone ?? null,
    }
    const outsourced = parseOutsourcedFields(body, currentFlags)
    if (!outsourced.ok) return NextResponse.json({ error: outsourced.error }, { status: 400 })

    // Desligar com solicitações aguardando a clínica deixaria essas consultas
    // sem dono (a resposta da clínica não seria mais reconhecida).
    if (isOutsourcedWorkspace(currentFlags) && !isOutsourcedWorkspace({ ...currentFlags, ...outsourced.value })) {
      const { data: pending, error: pendingError } = await supabase
        .from('appointments')
        .select('id')
        .eq('workspace_id', id)
        .eq('status', PENDING_EXTERNAL_STATUS)
        .limit(1)
      if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 500 })
      if ((pending ?? []).length > 0) {
        return NextResponse.json({ error: OUTSOURCED_DISABLE_WITH_PENDING_ERROR }, { status: 400 })
      }
    }
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

// Excluir unidade: arquiva (ver lib/workspaces/archive.ts). Os dados ficam.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await resolveActiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins do account podem excluir unidades.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: units, error: unitsError } = await supabase
    .from('workspaces')
    .select('id, slug, is_active, is_default, display_order')
    .eq('account_id', session.accountId)
    .order('display_order')
  if (unitsError) return NextResponse.json({ error: unitsError.message }, { status: 500 })

  const target = (units ?? []).find((w) => w.id === id)
  if (!target || !target.is_active) return NextResponse.json({ error: ARCHIVE_NOT_FOUND_ERROR }, { status: 404 })
  const others = (units ?? []).filter((w) => w.id !== id && w.is_active)
  if (others.length === 0) return NextResponse.json({ error: ARCHIVE_LAST_UNIT_ERROR }, { status: 400 })

  const { count, error: countError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', id)
    .in('status', [...ARCHIVE_BLOCKING_STATUSES])
    .gte('scheduled_at', new Date().toISOString())
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: archiveFutureAppointmentsError(count ?? 0) }, { status: 400 })
  }

  const { error } = await supabase
    .from('workspaces')
    .update({ is_active: false, is_default: false, slug: archivedSlug(target.slug, id) })
    .eq('id', id)
    .eq('account_id', session.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A account precisa de uma unidade padrão: passa para a próxima ativa.
  let newDefaultId: string | null = null
  if (target.is_default) {
    newDefaultId = others[0].id
    await supabase.from('workspaces').update({ is_default: true }).eq('id', newDefaultId).eq('account_id', session.accountId)
  }

  return NextResponse.json({ ok: true, newDefaultId })
}
