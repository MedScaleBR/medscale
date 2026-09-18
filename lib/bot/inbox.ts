import type { ConversationStatus, MessageRole } from '@/types/database'

export type InboxFilter = 'all' | 'open' | 'handoff' | 'resolved' | 'archived'
export type InboxSort = 'recent' | 'unread'

/** O mínimo que a lista precisa saber para filtrar e ordenar. */
export interface InboxEntry {
  status: ConversationStatus
  archived_at: string | null
  started_at: string
  last_message_at: string | null
  unread: boolean
}

export interface VisitSummary {
  last: string | null
  next: string | null
}

/**
 * Última e próxima consulta por telefone, para a barra de contexto.
 *
 * O vínculo é o telefone e não patient_id: conversa de paciente que ainda não
 * foi cadastrado só tem o número. Espera `appointments` ordenado por
 * `scheduled_at` crescente — assim a última passada é sempre a mais recente
 * vista até ali, e a próxima futura é a primeira que aparece.
 */
export function summarizeVisits(
  appointments: { patient_phone: string; scheduled_at: string }[],
  now: number = Date.now()
): Map<string, VisitSummary> {
  const visits = new Map<string, VisitSummary>()
  for (const a of appointments) {
    const entry = visits.get(a.patient_phone) ?? { last: null, next: null }
    const at = new Date(a.scheduled_at).getTime()
    if (Number.isNaN(at)) continue
    if (at <= now) entry.last = a.scheduled_at
    else if (!entry.next) entry.next = a.scheduled_at
    visits.set(a.patient_phone, entry)
  }
  return visits
}

/**
 * Não existe coluna de "lida" no banco. O que a equipe precisa saber é se
 * alguém ainda está esperando resposta: paciente falou por último e a conversa
 * não foi resolvida.
 */
export function isUnread(lastRole: MessageRole | undefined, status: ConversationStatus): boolean {
  return lastRole === 'user' && status !== 'resolved'
}

/** Data (e hora, quando a consulta é futura) no formato da barra de contexto. */
export function formatVisit(iso: string | null, withTime: boolean): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (!withTime) return date
  return `${date} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Arquivada é um estado à parte do status: só aparece na própria aba. Sem isso,
 * a conversa que a equipe tirou da caixa de entrada reaparece em "Todas".
 */
export function matchesFilter(c: Pick<InboxEntry, 'status' | 'archived_at'>, filter: InboxFilter): boolean {
  if (filter === 'archived') return Boolean(c.archived_at)
  if (c.archived_at) return false
  return filter === 'all' || c.status === filter
}

function recency(c: InboxEntry): number {
  const at = new Date(c.last_message_at ?? c.started_at).getTime()
  return Number.isNaN(at) ? 0 : at
}

/** Sempre mais recente primeiro; em "Não lidas", quem espera resposta sobe. */
export function sortConversations<T extends InboxEntry>(list: T[], sort: InboxSort): T[] {
  return [...list].sort((a, b) => {
    if (sort === 'unread' && a.unread !== b.unread) return a.unread ? -1 : 1
    return recency(b) - recency(a)
  })
}
