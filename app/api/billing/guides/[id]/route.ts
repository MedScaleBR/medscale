import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { isDate } from '@/lib/billing/validation'
import {
  applyGuideEdits,
  buildGuidePayload,
  computeMissingFields,
  loadAppointmentForGuide,
  loadGuideSources,
  mergeRefreshedPayload,
  statusForMissing,
  type GuideEdits,
} from '@/lib/billing/guides'
import { GUIDE_COLUMNS } from '@/lib/billing/constants'
import type { GuidePayload } from '@/lib/billing/types'

// Owner/admin. Guia 'draft'/'ready' pode ser editada ({ card_number,
// authorization_number, authorization_date, cid10, insurer_procedure_id }),
// recarregada das configurações ({ action: 'refresh' }) ou cancelada
// ({ action: 'cancel' }). 'batched'/'sent'/'cancelled' são somente leitura.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const body = await req.json()
  const supabase = await createClient()
  const { data: guide } = await supabase
    .from('tiss_guides')
    .select('id, appointment_id, insurer_id, status, payload')
    .eq('id', id)
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!guide) return NextResponse.json({ error: 'Guia não encontrada' }, { status: 404 })
  if (guide.status !== 'draft' && guide.status !== 'ready') {
    return NextResponse.json({ error: 'Guia já está em lote ou cancelada — somente leitura.' }, { status: 409 })
  }

  let update: { status: 'cancelled' } | { payload: GuidePayload; missing_fields: string[]; status: 'draft' | 'ready'; guide_type: GuidePayload['service']['guide_type']; total_cents: number }

  if (body.action === 'cancel') {
    update = { status: 'cancelled' }
  } else {
    let payload = guide.payload as GuidePayload

    if (body.action === 'refresh') {
      // Client admin só para montar o snapshot (o CRM/CBO do médico vem de
      // profiles, cuja RLS só libera a própria linha). A guia já foi
      // validada acima pela RLS de admin, e o carregamento fica preso à
      // account da consulta.
      const admin = createAdminClient()
      const appointment = await loadAppointmentForGuide(admin, guide.appointment_id)
      const loaded = appointment && appointment.account_id === session.accountId
        ? await loadGuideSources(admin, { ...appointment, insurer_id: guide.insurer_id })
        : null
      if (!loaded) return NextResponse.json({ error: 'Consulta da guia não encontrada' }, { status: 404 })
      payload = mergeRefreshedPayload(payload, buildGuidePayload(loaded.sources))
    }

    const edits: GuideEdits = {}
    for (const field of ['card_number', 'authorization_number', 'cid10'] as const) {
      if (field in body) {
        if (body[field] !== null && typeof body[field] !== 'string') {
          return NextResponse.json({ error: `${field} inválido` }, { status: 400 })
        }
        edits[field] = body[field]
      }
    }
    if (typeof edits.card_number === 'string' && edits.card_number.trim().length > 20) {
      return NextResponse.json({ error: 'Carteirinha tem no máximo 20 caracteres.' }, { status: 400 })
    }
    if ('authorization_date' in body) {
      if (body.authorization_date && !isDate(body.authorization_date)) {
        return NextResponse.json({ error: 'Data da autorização inválida' }, { status: 400 })
      }
      edits.authorization_date = body.authorization_date || null
    }
    if (typeof body.insurer_procedure_id === 'string') {
      const { data: procedure } = await supabase
        .from('insurer_procedures')
        .select('tuss_code, description, price_cents, guide_type')
        .eq('id', body.insurer_procedure_id)
        .eq('insurer_id', guide.insurer_id)
        .eq('account_id', session.accountId)
        .maybeSingle()
      if (!procedure) return NextResponse.json({ error: 'Procedimento não é desta operadora' }, { status: 400 })
      edits.procedure = procedure
    }

    payload = applyGuideEdits(payload, edits)
    const missing = computeMissingFields(payload)
    update = {
      payload,
      missing_fields: missing,
      status: statusForMissing(missing),
      guide_type: payload.service.guide_type,
      total_cents: payload.service.price_cents,
    }
  }

  // O filtro de status repete a checagem: se o cron fechou um lote com esta
  // guia entre a leitura e aqui, nada é gravado.
  const { data, error } = await supabase
    .from('tiss_guides')
    .update(update)
    .eq('id', id)
    .eq('account_id', session.accountId)
    .in('status', ['draft', 'ready'])
    .select(GUIDE_COLUMNS)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Guia entrou em lote enquanto era editada.' }, { status: 409 })
  return NextResponse.json(data)
}
