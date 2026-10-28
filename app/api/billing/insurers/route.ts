import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireInsurerAccess } from '@/lib/billing/access'
import { parseInsurerInput } from '@/lib/billing/validation'
import type { Database } from '@/types/database'
import {
  INSURER_UNITS_SELECT,
  parseWorkspaceIds,
  syncInsurerWorkspaces,
  withWorkspaceIds,
} from '@/lib/billing/insurer-units'

type InsurerInsert = Database['public']['Tables']['health_insurers']['Insert']

// Colunas expostas ao client — os contadores next_*_number ficam de fora.
const COLUMNS =
  'id, name, ans_registry, provider_code, tiss_version, default_consult_guide, batch_weekdays, batch_hour, ' +
  'max_guides_per_batch, is_active, created_at'

// Qualquer membro: convênios ativos (seletor da agenda), com ou sem o módulo billing. Owner/admin
// pode pedir ?all=1 para incluir as inativas (tela de configuração).
export async function GET(req: NextRequest) {
  const result = await requireInsurerAccess(req, { adminOnly: false })
  if ('error' in result) return result.error
  const { session } = result

  const includeInactive = req.nextUrl.searchParams.get('all') === '1' && session.role !== 'member'
  const supabase = await createClient()
  // Com as unidades que aceitam cada convênio (a Agenda filtra por unidade).
  // Sem a tabela de vínculo (migration pendente), devolve workspace_ids null.
  const list = (columns: string) => {
    let query = supabase.from('health_insurers').select(columns).eq('account_id', session.accountId).order('name')
    if (!includeInactive) query = query.eq('is_active', true)
    return query
  }
  let { data, error } = await list(`${COLUMNS}, ${INSURER_UNITS_SELECT}`)
  if (error) ({ data, error } = await list(COLUMNS))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { health_insurer_workspaces?: { workspace_id: string }[] | null }>
  return NextResponse.json(rows.map(withWorkspaceIds))
}

export async function POST(req: NextRequest) {
  const result = await requireInsurerAccess(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session, billingEnabled } = result

  const body = await req.json()
  const parsed = parseInsurerInput(body, false, { tiss: billingEnabled })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const units = parseWorkspaceIds(body)
  if (!units.ok) return NextResponse.json({ error: units.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('health_insurers')
    .insert({ ...parsed.value, account_id: session.accountId } as InsurerInsert)
    .select(COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Já existe uma operadora com esse registro ANS.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const insurer = data as unknown as { id: string }
  const linked = await syncInsurerWorkspaces(supabase, session.accountId, insurer.id, units.value ?? [])
  if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status })
  return NextResponse.json({ ...insurer, workspace_ids: linked.value }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const result = await requireInsurerAccess(req, { adminOnly: true })
  if ('error' in result) return result.error
  const { session, billingEnabled } = result

  const body = await req.json()
  if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 })
  const parsed = parseInsurerInput(body, true, { tiss: billingEnabled })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const units = parseWorkspaceIds(body)
  if (!units.ok) return NextResponse.json({ error: units.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('health_insurers')
    .update(parsed.value)
    .eq('id', body.id)
    .eq('account_id', session.accountId)
    .select(COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Já existe uma operadora com esse registro ANS.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Operadora não encontrada' }, { status: 404 })
  if (units.value === null) return NextResponse.json(data)
  const insurer = data as unknown as { id: string }
  const linked = await syncInsurerWorkspaces(supabase, session.accountId, insurer.id, units.value)
  if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status })
  return NextResponse.json({ ...insurer, workspace_ids: linked.value })
}
