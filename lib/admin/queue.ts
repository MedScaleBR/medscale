import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountTaskSourceType, AccountTaskStatus, Database } from '@/types/database'
import { getCostOverview, type CostAlertWithRef } from '@/lib/admin/cost-alerts'

// Fila de trabalho do /admin: uma lista única com o que pede ação — tarefa
// vencida, alerta de custo e feedback não lido que ainda não viraram tarefa,
// depois o resto das tarefas abertas por prazo. A montagem (ordenação, dedup
// por source_ref, idade em dias no fuso de São Paulo) é pura em
// buildAdminQueue; getAdminQueue só busca os dados.

const TZ = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000

export const OPEN_TASK_STATUSES: AccountTaskStatus[] = ['todo', 'doing']

export type QueueItemKind = 'task' | 'alert' | 'feedback'

export interface QueueAssignee {
  id: string
  name: string | null
  email: string | null
}

export interface QueueItem {
  /** Tarefa: id da tarefa. Alerta: o ref. Feedback: id do feedback. */
  id: string
  kind: QueueItemKind
  title: string
  /** Pronto para exibir: `Cliente · responsável`, `Cliente · R$ x em N dias`. */
  subtitle: string
  accountId: string | null
  accountName: string | null
  /**
   * Dias inteiros (fuso de São Paulo). Tarefa vencida: dias de atraso.
   * Demais tarefas, feedback: dias desde a criação. Alerta: 0 (detectado agora).
   */
  age: number
  overdue: boolean
  /** source_ref para "Virar tarefa" (alerta/feedback). */
  ref?: string
  sourceType?: AccountTaskSourceType
  /** Só tarefas. */
  taskId?: string
  status?: AccountTaskStatus
  dueDate?: string | null
  position?: number
  assignee?: QueueAssignee | null
  /** Tarefa que nasceu de alerta/feedback. */
  taskSourceType?: AccountTaskSourceType | null
  /** Só alertas: custo do sintoma no período, em reais. */
  cost?: number
  /** Só alertas: frase com os números. */
  detail?: string
  /** Só feedback: mensagem inteira e autor. */
  message?: string
  authorName?: string | null
  createdAt: string | null
}

export interface QueueTaskRow {
  id: string
  title: string
  status: AccountTaskStatus
  due_date: string | null
  position: number
  account_id: string | null
  assigned_to: string | null
  source_type: AccountTaskSourceType | null
  source_ref: string | null
  created_at: string
  accounts?: { name: string } | null
}

export interface QueueFeedbackRow {
  id: string
  message: string
  created_at: string
  account_id: string | null
  user_id: string | null
  accounts?: { name: string } | null
}

export interface QueueProfile {
  id: string
  full_name: string | null
  email: string | null
}

export interface AdminQueue {
  items: QueueItem[]
  counts: { all: number; task: number; alert: number; feedback: number; overdue: number }
  /** source_ref que já têm tarefa (qualquer status) — estado inicial do "Virar tarefa". */
  taskedRefs: string[]
}

// ============================================================
// Datas no fuso de São Paulo
// ============================================================

/** YYYY-MM-DD do instante em São Paulo. */
export function saoPauloDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Dias inteiros de `from` até `to` (ambos YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** due_date é `date` puro: vence quando o dia já passou em São Paulo. */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return !!dueDate && dueDate < today
}

// ============================================================
// Montagem pura
// ============================================================

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function joinSubtitle(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ')
}

export function buildAdminQueue(input: {
  tasks: QueueTaskRow[]
  taskedRefs: Iterable<string>
  alerts: CostAlertWithRef[]
  alertDays: number
  feedback: QueueFeedbackRow[]
  profiles: QueueProfile[]
  now: Date
}): AdminQueue {
  const today = saoPauloDate(input.now)
  const tasked = new Set(input.taskedRefs)
  const profiles = new Map(input.profiles.map((p) => [p.id, p]))

  const tasks: QueueItem[] = input.tasks.map((t): QueueItem => {
    const overdue = isOverdue(t.due_date, today)
    const profile = t.assigned_to ? profiles.get(t.assigned_to) : undefined
    const assignee = t.assigned_to
      ? { id: t.assigned_to, name: profile?.full_name ?? null, email: profile?.email ?? null }
      : null
    const accountName = t.accounts?.name ?? null
    return {
      id: t.id,
      kind: 'task',
      title: t.title,
      // Tarefa sem account é interna da MedScale.
      subtitle: joinSubtitle([accountName ?? 'Interna', assignee?.name ?? assignee?.email]),
      accountId: t.account_id,
      accountName,
      age: overdue ? daysBetween(t.due_date!, today) : Math.max(0, daysBetween(saoPauloDate(t.created_at), today)),
      overdue,
      taskId: t.id,
      status: t.status,
      dueDate: t.due_date,
      position: t.position,
      assignee,
      taskSourceType: t.source_type,
      createdAt: t.created_at,
    }
  })

  // Dedup: alerta/feedback que já virou tarefa aparece como a tarefa, não duas vezes.
  const alerts: QueueItem[] = input.alerts
    .filter((a) => !tasked.has(a.ref))
    .map((a): QueueItem => ({
      id: a.ref,
      kind: 'alert',
      title: a.title,
      subtitle: joinSubtitle([a.accountName, `${brl(a.cost)} em ${input.alertDays} dias`]),
      accountId: a.accountId,
      accountName: a.accountName,
      age: 0,
      overdue: false,
      ref: a.ref,
      sourceType: 'cost_alert',
      cost: a.cost,
      detail: a.detail,
      createdAt: null,
    }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))

  const feedback: QueueItem[] = input.feedback
    .filter((f) => !tasked.has(f.id))
    .map((f): QueueItem => {
      const accountName = f.accounts?.name ?? null
      const author = f.user_id ? profiles.get(f.user_id) : undefined
      const authorName = author?.full_name ?? author?.email ?? null
      return {
        id: f.id,
        kind: 'feedback',
        title: f.message,
        subtitle: joinSubtitle([accountName, authorName]),
        accountId: f.account_id,
        accountName,
        age: Math.max(0, daysBetween(saoPauloDate(f.created_at), today)),
        overdue: false,
        ref: f.id,
        sourceType: 'feedback',
        message: f.message,
        authorName,
        createdAt: f.created_at,
      }
    })
    // Mais antigo primeiro: é quem está esperando há mais tempo.
    .sort((a, b) => b.age - a.age || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))

  const overdueTasks = tasks.filter((t) => t.overdue).sort((a, b) => b.age - a.age)
  // Sem prazo vai para o fim; empate por criação.
  const otherTasks = tasks
    .filter((t) => !t.overdue)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      }
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    })

  const items = [...overdueTasks, ...alerts, ...feedback, ...otherTasks]

  return {
    items,
    counts: {
      all: items.length,
      task: tasks.length,
      alert: alerts.length,
      feedback: feedback.length,
      overdue: overdueTasks.length,
    },
    taskedRefs: [...tasked],
  }
}

// ============================================================
// Consultas
// ============================================================

/** source_ref de toda tarefa vinculada a alerta/feedback, em qualquer status. */
export async function getTaskedRefs(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const { data } = await supabase
    .from('account_tasks')
    .select('source_ref')
    .not('source_type', 'is', null)
    .not('source_ref', 'is', null)
  return new Set((data ?? []).map((r) => r.source_ref).filter((r): r is string => !!r))
}

export async function getAdminQueue(
  supabase: SupabaseClient<Database>,
  options: { now?: Date; alertDays?: number; costAlerts?: CostAlertWithRef[] } = {},
): Promise<AdminQueue> {
  const now = options.now ?? new Date()
  const alertDays = options.alertDays ?? 30

  const [tasksRes, taskedRefs, feedbackRes, alerts] = await Promise.all([
    supabase
      .from('account_tasks')
      .select('id, title, status, due_date, position, account_id, assigned_to, source_type, source_ref, created_at, accounts(name)')
      .in('status', OPEN_TASK_STATUSES),
    getTaskedRefs(supabase),
    supabase
      .from('feedback')
      .select('id, message, created_at, account_id, user_id, accounts(name)')
      .eq('status', 'new'),
    // Quem já tem a visão de custos (página de custos) passa os alertas e
    // evita uma segunda varredura de cost_events.
    options.costAlerts ?? getCostOverview(supabase, alertDays, now).then((o) => o.alerts),
  ])

  const tasks = (tasksRes.data ?? []) as unknown as QueueTaskRow[]
  const feedback = (feedbackRes.data ?? []) as unknown as QueueFeedbackRow[]

  // Responsáveis e autores numa consulta só: profiles é legível pelo admin
  // (policy "profiles: medscale admin full").
  const profileIds = [
    ...new Set(
      [...tasks.map((t) => t.assigned_to), ...feedback.map((f) => f.user_id)].filter((id): id is string => !!id),
    ),
  ]
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', profileIds)
    : { data: [] }

  return buildAdminQueue({
    tasks,
    taskedRefs,
    alerts,
    alertDays,
    feedback,
    profiles: (profiles ?? []) as QueueProfile[],
    now,
  })
}
