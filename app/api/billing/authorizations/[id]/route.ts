import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { loadAuthorizationDetail } from '@/lib/billing/authorizations/detail'
import { applyContentPatch, refreshPayload, type PatchDeps } from '@/lib/billing/authorizations/edit'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError, readOnlyConflict } from '@/lib/billing/authorizations/rpc-errors'
import { loadAuthorizationSources } from '@/lib/billing/authorizations/sources'
import type { AnyAuthorizationPayload } from '@/lib/billing/authorizations/types'
import { parseContentPatch } from '@/lib/billing/authorizations/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const supabase = await createClient()
  const found = await loadAuthorizationDetail(supabase, result.session.accountId, id)
  if (!found) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  return NextResponse.json(found)
}

// Conteúdo só em draft/ready (o RPC repete a regra e confere updated_at).
// { action: 'refresh' } = "Recarregar dados" (configurações novas, pedido preservado).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parseContentPatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const patch = parsed.value

  const supabase = await createClient()
  const current = await loadAuthorizationDetail(supabase, session.accountId, id)
  if (!current) return NextResponse.json({ error: 'Autorização não encontrada' }, { status: 404 })
  const a = current.authorization
  const readOnly = readOnlyConflict(a.status)
  if (readOnly) return readOnly

  let payload: AnyAuthorizationPayload
  try {
    const needsSources = patch.refresh || patch.professional_id !== undefined || patch.patient_insurance_id !== undefined
    if (needsSources) {
      const loaded = await loadAuthorizationSources(supabase, {
        accountId: session.accountId,
        workspaceId: a.workspace_id,
        insurerId: a.insurer_id,
        patientId: a.patient_id,
        patientInsuranceId: patch.patient_insurance_id !== undefined ? patch.patient_insurance_id : a.payload.beneficiary.patient_insurance_id,
        professionalId: patch.professional_id !== undefined ? patch.professional_id : a.payload.professional.id,
      })
      if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
      if (patch.refresh) {
        payload = refreshPayload(a.payload, loaded.sources)
      } else {
        if (patch.professional_id && !loaded.sources.professional) {
          return NextResponse.json({ error: 'Profissional não encontrado ou sem CRM cadastrado.' }, { status: 400 })
        }
        if (patch.patient_insurance_id && !loaded.sources.patientInsurance) {
          return NextResponse.json({ error: 'Carteirinha não é deste paciente nesta operadora.' }, { status: 400 })
        }
        const deps: PatchDeps = {
          professional: patch.professional_id !== undefined ? loaded.sources.professional : undefined,
          patientInsurance: patch.patient_insurance_id !== undefined ? loaded.sources.patientInsurance : undefined,
        }
        const applied = applyContentPatch(a.payload, patch, deps)
        if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 })
        payload = applied.value
      }
    } else {
      const applied = applyContentPatch(a.payload, patch, {})
      if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 })
      payload = applied.value
    }
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os dados da autorização.' }, { status: 500 })
  }

  const { error } = await supabase.rpc('update_tiss_authorization', {
    p_id: id,
    p_expected_updated_at: patch.expected_updated_at,
    p_payload: payload,
    p_missing_fields: computeAuthorizationMissing(payload, current.items.length),
    p_requested_at: patch.requested_at ?? null,
    p_event: patch.refresh ? 'refreshed' : 'updated',
  })
  if (error) return authorizationRpcError(error)
  return NextResponse.json(await loadAuthorizationDetail(supabase, session.accountId, id))
}
