import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireBilling } from '@/lib/billing/access'
import { AUTHORIZATION_LIST_COLUMNS } from '@/lib/billing/authorizations/constants'
import { computeAuthorizationMissing } from '@/lib/billing/authorizations/missing'
import { authorizationRpcError } from '@/lib/billing/authorizations/rpc-errors'
import { resolveCreateContext } from '@/lib/billing/authorizations/sources'
import { isAuthorizationStatus, isAuthorizationType } from '@/lib/billing/authorizations/status'
import { parseCreateBody } from '@/lib/billing/authorizations/validation'

const PAGE_SIZE = 50
// Data de calendário real (2026-02-30 e 2026-99-99 não passam).
function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Só owner/admin com o módulo billing ativo na account (P1/P2, como guias e
// lotes); a RLS repete is_account_admin. Filtros: ?status=draft,sent &type=
// &insurer_id= &patient_id= &professional_id= &from=&to= (data da solicitação) &page=
export async function GET(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const sp = req.nextUrl.searchParams
  const rawPage = Math.floor(Number(sp.get('page')))
  const page = Number.isFinite(rawPage) ? Math.min(10000, Math.max(1, rawPage)) : 1
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from && !isRealDate(from)) || (to && !isRealDate(to))) {
    return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
  }
  const statuses = (sp.get('status') ?? '').split(',').filter(isAuthorizationStatus)
  const type = sp.get('type')

  const supabase = await createClient()
  let query = supabase
    .from('tiss_authorizations')
    .select(AUTHORIZATION_LIST_COLUMNS, { count: 'exact' })
    .eq('account_id', session.accountId)
    .order('requested_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (statuses.length > 0) query = query.in('status', statuses)
  if (isAuthorizationType(type)) query = query.eq('type', type)
  for (const key of ['insurer_id', 'patient_id'] as const) {
    const value = sp.get(key)
    if (value && UUID.test(value)) query = query.eq(key, value)
  }
  const professionalId = sp.get('professional_id')
  if (professionalId && UUID.test(professionalId)) {
    query = query.filter('payload->professional->>id', 'eq', professionalId)
  }
  if (from) query = query.gte('requested_at', from)
  if (to) query = query.lte('requested_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: 'Não foi possível carregar as autorizações.' }, { status: 500 })
  return NextResponse.json({ authorizations: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}

// Cria a partir do agendamento, do paciente+operadora ou (OPME) da guia de
// origem. O snapshot é montado aqui; o RPC numera, valida acesso e grava.
export async function POST(req: NextRequest) {
  const result = await requireBilling(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session } = result

  const parsed = parseCreateBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()
  let resolved: Awaited<ReturnType<typeof resolveCreateContext>>
  try {
    resolved = await resolveCreateContext(supabase, session, parsed.value)
  } catch {
    return NextResponse.json({ error: 'Não foi possível montar a autorização.' }, { status: 500 })
  }
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { context } = resolved
  const { data, error } = await supabase.rpc('create_tiss_authorization', {
    p_workspace_id: context.workspaceId,
    p_patient_id: context.patientId,
    p_insurer_id: context.insurerId,
    p_type: parsed.value.type,
    p_appointment_id: context.appointmentId,
    p_parent_id: context.parentId,
    p_payload: context.payload,
    p_missing_fields: computeAuthorizationMissing(context.payload, context.items.length),
    p_items: context.items,
  })
  if (error || !data) return authorizationRpcError(error)
  return NextResponse.json(data, { status: 201 })
}
