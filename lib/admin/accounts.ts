import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountPlan, AccountTaskStatus, Database, ModuleSlug } from '@/types/database'
import { MAX_EVENTS } from '@/lib/admin/cost-alerts'
import { OPEN_TASK_STATUSES, isOverdue, saoPauloDate } from '@/lib/admin/queue'

// Lista de accounts do /admin: accounts + memberships ativas + custo dos
// últimos 30 dias + tarefas abertas, em 4 consultas paralelas (sem N+1). A
// agregação por account_id é pura em buildAccountRows, para ser testada sem
// Supabase.

const DAY_MS = 24 * 60 * 60 * 1000

/** Custo 30d acima disto aparece em vermelho na lista. */
export const COST_HIGHLIGHT_BRL = 100

// Dashboard, Pacientes e Configurações são sempre ativos (lib/session/server.ts)
// e não entram na contagem "7/10".
export const TOGGLEABLE_MODULES: { slug: ModuleSlug; label: string }[] = [
  { slug: 'agenda', label: 'Minha agenda' },
  { slug: 'conversations', label: 'Conversas' },
  { slug: 'locations', label: 'Meus locais' },
  { slug: 'schedule', label: 'Meu expediente' },
  { slug: 'waitlist', label: 'Lista de espera' },
  { slug: 'campaigns', label: 'Atribuição' },
  { slug: 'transcriptions', label: 'Transcrições' },
  { slug: 'finance', label: 'Financeiro (agente PF/PJ)' },
  { slug: 'revenue_cycle', label: 'Ciclo de receita' },
  { slug: 'billing', label: 'Faturamento de convênios (TISS)' },
]

const TOGGLEABLE_SLUGS = new Set<ModuleSlug>(TOGGLEABLE_MODULES.map((m) => m.slug))

export interface AccountBaseRow {
  id: string
  name: string
  slug: string
  plan: AccountPlan
  is_active: boolean
  modules: ModuleSlug[] | null
  created_at: string
}

export interface AccountListRow {
  id: string
  name: string
  slug: string
  plan: AccountPlan
  is_active: boolean
  created_at: string
  modulesOn: number
  modulesTotal: number
  /** Memberships com status 'active'. */
  members: number
  /** Soma de cost_events.cost_brl nos últimos 30 dias, em reais. */
  cost30d: number
  /** Tarefas 'todo' + 'doing'. */
  openTasks: number
  /** Abertas com due_date anterior a hoje em São Paulo. */
  overdueTasks: number
}

export interface AccountsOverview {
  rows: AccountListRow[]
  /** A consulta de custo bateu no teto — valores subestimados. */
  costTruncated: boolean
  error: string | null
}

function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function countToggleableModules(modules: ModuleSlug[] | null | undefined): number {
  return new Set((modules ?? []).filter((m) => TOGGLEABLE_SLUGS.has(m))).size
}

export function sumCost(rows: { cost_brl: number | string | null }[]): number {
  return rows.reduce((total, r) => total + toNumber(r.cost_brl), 0)
}

export function buildAccountRows(input: {
  accounts: AccountBaseRow[]
  memberships: { account_id: string }[]
  costs: { account_id: string; cost_brl: number | string | null }[]
  tasks: { account_id: string | null; due_date: string | null; status: AccountTaskStatus }[]
  /** YYYY-MM-DD em São Paulo. */
  today: string
}): AccountListRow[] {
  const members = new Map<string, number>()
  for (const m of input.memberships) members.set(m.account_id, (members.get(m.account_id) ?? 0) + 1)

  const costs = new Map<string, number>()
  for (const c of input.costs) costs.set(c.account_id, (costs.get(c.account_id) ?? 0) + toNumber(c.cost_brl))

  const open = new Map<string, number>()
  const overdue = new Map<string, number>()
  for (const t of input.tasks) {
    if (!t.account_id || !OPEN_TASK_STATUSES.includes(t.status)) continue
    open.set(t.account_id, (open.get(t.account_id) ?? 0) + 1)
    if (isOverdue(t.due_date, input.today)) overdue.set(t.account_id, (overdue.get(t.account_id) ?? 0) + 1)
  }

  return input.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    plan: a.plan,
    is_active: a.is_active,
    created_at: a.created_at,
    modulesOn: countToggleableModules(a.modules),
    modulesTotal: TOGGLEABLE_MODULES.length,
    members: members.get(a.id) ?? 0,
    cost30d: costs.get(a.id) ?? 0,
    openTasks: open.get(a.id) ?? 0,
    overdueTasks: overdue.get(a.id) ?? 0,
  }))
}

export async function getAccountsOverview(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<AccountsOverview> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString()

  const [accountsRes, membershipsRes, costsRes, tasksRes] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, slug, plan, is_active, modules, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('memberships').select('account_id').eq('status', 'active'),
    supabase.from('cost_events').select('account_id, cost_brl').gte('created_at', since).limit(MAX_EVENTS),
    supabase
      .from('account_tasks')
      .select('account_id, due_date, status')
      .in('status', OPEN_TASK_STATUSES)
      .not('account_id', 'is', null),
  ])

  const costs = costsRes.data ?? []
  const rows = buildAccountRows({
    accounts: (accountsRes.data ?? []) as AccountBaseRow[],
    memberships: membershipsRes.data ?? [],
    costs,
    tasks: tasksRes.data ?? [],
    today: saoPauloDate(now),
  })

  const error =
    accountsRes.error?.message ??
    membershipsRes.error?.message ??
    costsRes.error?.message ??
    tasksRes.error?.message ??
    null

  return { rows, costTruncated: costs.length >= MAX_EVENTS, error }
}
