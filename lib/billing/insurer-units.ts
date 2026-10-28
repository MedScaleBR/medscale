import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Unidades que aceitam cada convênio (health_insurer_workspaces). A Clara e a
// Agenda só oferecem o convênio nessas unidades.

/** Seleção do convênio com as unidades ligadas a ele. */
export const INSURER_UNITS_SELECT = 'health_insurer_workspaces(workspace_id)'

type WithLinks = { health_insurer_workspaces?: { workspace_id: string }[] | null }

/** Troca o vínculo aninhado por `workspace_ids` (null = vínculo indisponível). */
export function withWorkspaceIds<T extends WithLinks>(
  row: T
): Omit<T, 'health_insurer_workspaces'> & { workspace_ids: string[] | null } {
  const { health_insurer_workspaces: links, ...rest } = row
  return { ...rest, workspace_ids: Array.isArray(links) ? links.map((l) => l.workspace_id) : null }
}

/** `workspace_ids` do body: ausente = não mexe; senão lista de ids sem repetição. */
export function parseWorkspaceIds(body: Record<string, unknown>): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (!('workspace_ids' in body) || body.workspace_ids === undefined) return { ok: true, value: null }
  const ids = body.workspace_ids
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    return { ok: false, error: 'Unidades inválidas.' }
  }
  return { ok: true, value: [...new Set(ids as string[])] }
}

/**
 * Deixa o convênio ligado exatamente às unidades pedidas. Só aceita unidades
 * da account (a trigger do banco também confere).
 */
export async function syncInsurerWorkspaces(
  supabase: SupabaseClient<Database>,
  accountId: string,
  insurerId: string,
  workspaceIds: string[]
): Promise<{ ok: true; value: string[] } | { ok: false; error: string; status: number }> {
  if (workspaceIds.length > 0) {
    const { data: units, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('account_id', accountId)
      .in('id', workspaceIds)
    if (error) return { ok: false, error: error.message, status: 500 }
    if ((units ?? []).length !== workspaceIds.length) {
      return { ok: false, error: 'Unidade não encontrada.', status: 400 }
    }
  }

  const del = supabase.from('health_insurer_workspaces').delete().eq('insurer_id', insurerId)
  const { error: delError } =
    workspaceIds.length > 0 ? await del.not('workspace_id', 'in', `(${workspaceIds.join(',')})`) : await del
  if (delError) return { ok: false, error: delError.message, status: 500 }

  if (workspaceIds.length > 0) {
    const { error: insError } = await supabase
      .from('health_insurer_workspaces')
      .upsert(
        workspaceIds.map((workspace_id) => ({ insurer_id: insurerId, workspace_id, account_id: accountId })),
        { onConflict: 'insurer_id,workspace_id', ignoreDuplicates: true }
      )
    if (insError) return { ok: false, error: insError.message, status: 500 }
  }
  return { ok: true, value: workspaceIds }
}

/**
 * A forma de atendimento cabe na unidade? Usado pela Agenda (POST/PATCH de
 * consulta). `insurerId` vem do módulo billing; sem ele, `healthPlan` é o nome
 * do convênio. Nome que não bate com nenhum convênio cadastrado (texto antigo)
 * não é conferido. Sem as colunas novas (migration pendente) não bloqueia.
 * Devolve a mensagem de erro, ou null se está ok.
 */
export async function unitPaymentProblem(
  supabase: SupabaseClient<Database>,
  { accountId, workspaceId, insurerId, healthPlan }: {
    accountId: string
    workspaceId: string
    insurerId: string | null
    healthPlan: string | null
  }
): Promise<string | null> {
  const { data: unit, error: unitError } = await supabase
    .from('workspaces')
    .select('name, accepts_private')
    .eq('id', workspaceId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (unitError || !unit) return null

  let id = insurerId
  if (!id && healthPlan) {
    const { data: byName } = await supabase
      .from('health_insurers')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', healthPlan)
      .limit(1)
      .maybeSingle()
    if (!byName) return null
    id = byName.id
  }

  if (!id) {
    return unit.accepts_private === false ? `A unidade ${unit.name} não atende particular. Escolha um convênio.` : null
  }

  const { data: link, error: linkError } = await supabase
    .from('health_insurer_workspaces')
    .select('insurer_id')
    .eq('insurer_id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (linkError) return null
  return link ? null : `A unidade ${unit.name} não aceita este convênio.`
}
