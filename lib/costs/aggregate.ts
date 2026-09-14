import type { CostProvider } from '@/types/database'

// Agregação do painel /admin/costs. Fica separada da página para poder ser
// testada sem Supabase nem React: a regra de "qual bot está mal configurado" é
// a parte que erra e a que precisa de teste.

export const PROVIDER_LABELS: Record<CostProvider, string> = {
  claude_agendamento: 'Clara (agendamento)',
  claude_financeiro: 'Agente financeiro',
  claude_soap: 'Prontuário (SOAP)',
  whisper: 'Transcrição (Whisper)',
  whatsapp_conversation: 'Conversas WhatsApp',
}

export const PROVIDER_ORDER = Object.keys(PROVIDER_LABELS) as CostProvider[]

/** Uma linha de cost_events, só com o que a agregação usa. */
export interface CostEventRow {
  provider: CostProvider
  cost_brl: number | string
  account_id: string
  workspace_id: string | null
  related_id: string | null
  accounts?: { name: string } | null
  workspaces?: { name: string } | null
}

export interface UnitCost {
  workspaceId: string | null
  name: string
  total: number
}

export interface AccountCost {
  accountId: string
  name: string
  total: number
  byProvider: Record<CostProvider, number>
  units: UnitCost[]
}

export interface CostSummary {
  total: number
  byProvider: Record<CostProvider, number>
  accounts: AccountCost[]
}

/** numeric do Postgres chega como string no supabase-js. */
function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function emptyByProvider(): Record<CostProvider, number> {
  return Object.fromEntries(PROVIDER_ORDER.map((p) => [p, 0])) as Record<CostProvider, number>
}

// Rótulo do balde de custo sem unidade. Não é um erro: a Clara é configurada
// por account e conversations.workspace_id fica NULL até o paciente dizer em
// qual unidade quer ser atendido. Inventar uma unidade aqui seria pior do que
// mostrar o balde.
export const NO_UNIT_LABEL = 'Sem unidade'

export function summarizeCosts(rows: CostEventRow[]): CostSummary {
  const byProvider = emptyByProvider()
  const accounts = new Map<string, AccountCost>()
  const units = new Map<string, Map<string, UnitCost>>()
  let total = 0

  for (const row of rows) {
    const cost = toNumber(row.cost_brl)
    total += cost
    if (row.provider in byProvider) byProvider[row.provider] += cost

    let account = accounts.get(row.account_id)
    if (!account) {
      account = {
        accountId: row.account_id,
        name: row.accounts?.name ?? 'Cliente removido',
        total: 0,
        byProvider: emptyByProvider(),
        units: [],
      }
      accounts.set(row.account_id, account)
      units.set(row.account_id, new Map())
    }
    account.total += cost
    if (row.provider in account.byProvider) account.byProvider[row.provider] += cost

    const unitKey = row.workspace_id ?? '__none__'
    const accountUnits = units.get(row.account_id)!
    const unit = accountUnits.get(unitKey)
    if (unit) {
      unit.total += cost
    } else {
      accountUnits.set(unitKey, {
        workspaceId: row.workspace_id,
        name: row.workspaces?.name ?? NO_UNIT_LABEL,
        total: cost,
      })
    }
  }

  for (const [accountId, accountUnits] of units) {
    accounts.get(accountId)!.units = [...accountUnits.values()].sort((a, b) => b.total - a.total)
  }

  return {
    total,
    byProvider,
    accounts: [...accounts.values()].sort((a, b) => b.total - a.total),
  }
}

// ============================================================
// Detecção de bot mal configurado
// ============================================================

export type CostAlertKind = 'conversation_loop' | 'custo_por_conversa'

export interface CostAlert {
  kind: CostAlertKind
  accountId: string
  accountName: string
  /** Texto pronto: o painel é interno, não vale a pena montar isso na view. */
  detail: string
  /** Quanto esse sintoma custou no período, em reais. */
  cost: number
}

// Uma conversa de agendamento saudável gasta poucas chamadas ao Claude: o
// paciente pergunta, a Clara responde, marca e acaba. Passar disso é a
// assinatura de loop — a Clara não entende, repete, o paciente repete.
export const LOOP_TURN_THRESHOLD = 25

// Acima disto, a conversa média daquele cliente saiu cara demais para ser
// conversa normal de agendamento (curta: paciente pergunta, Clara oferece
// horário, ele escolhe). Média alta costuma ser bot em loop ou handoff que
// nunca resolve.
export const COST_PER_CONVERSATION_ALERT_BRL = 0.5

// Piso de volume: uma conta com 1 ou 2 conversas no período produz média
// instável, que viraria alerta a cada semana morta e queimaria a credibilidade
// do painel.
export const MIN_CONVERSATIONS_FOR_ALERT = 5

/**
 * Conversas em loop: muitas chamadas ao Claude na MESMA conversa dentro do
 * período. O sinal já está em cost_events (uma linha por chamada), então não
 * precisa varrer `messages` — e o custo do loop sai junto de graça, que é
 * justamente o número que importa aqui.
 */
export function detectLoopAlerts(rows: CostEventRow[]): CostAlert[] {
  const perConversation = new Map<string, { accountId: string; accountName: string; turns: number; cost: number }>()

  for (const row of rows) {
    if (row.provider !== 'claude_agendamento' || !row.related_id) continue
    const found = perConversation.get(row.related_id)
    if (found) {
      found.turns += 1
      found.cost += toNumber(row.cost_brl)
    } else {
      perConversation.set(row.related_id, {
        accountId: row.account_id,
        accountName: row.accounts?.name ?? 'Cliente removido',
        turns: 1,
        cost: toNumber(row.cost_brl),
      })
    }
  }

  // Agrega por cliente: cinco conversas em loop no mesmo cliente é um bot mal
  // configurado, não cinco incidentes separados.
  const perAccount = new Map<string, CostAlert & { conversations: number }>()
  for (const conv of perConversation.values()) {
    if (conv.turns < LOOP_TURN_THRESHOLD) continue
    const found = perAccount.get(conv.accountId)
    if (found) {
      found.conversations += 1
      found.cost += conv.cost
    } else {
      perAccount.set(conv.accountId, {
        kind: 'conversation_loop',
        accountId: conv.accountId,
        accountName: conv.accountName,
        conversations: 1,
        cost: conv.cost,
        detail: '',
      })
    }
  }

  return [...perAccount.values()]
    .map((a) => ({
      kind: a.kind,
      accountId: a.accountId,
      accountName: a.accountName,
      cost: a.cost,
      detail:
        a.conversations === 1
          ? `1 conversa passou de ${LOOP_TURN_THRESHOLD} respostas da Clara`
          : `${a.conversations} conversas passaram de ${LOOP_TURN_THRESHOLD} respostas da Clara`,
    }))
    .sort((a, b) => b.cost - a.cost)
}

/**
 * Clientes cuja conversa média sai cara demais. Normaliza pelo volume, então
 * pega o que o contador de turnos não pega: a conta inteira rodando cara, em
 * vez de uma conversa isolada patológica.
 *
 * Só olha o custo que depende de o paciente conversar (Clara + janela do
 * WhatsApp). Prontuário e financeiro entrariam aqui como ruído: uma clínica que
 * grava muita consulta pareceria um bot em loop.
 */
export function detectExpensiveAccountAlerts(rows: CostEventRow[]): CostAlert[] {
  const perAccount = new Map<string, { name: string; cost: number; conversations: Set<string> }>()

  for (const row of rows) {
    if (row.provider !== 'claude_agendamento' && row.provider !== 'whatsapp_conversation') continue

    let account = perAccount.get(row.account_id)
    if (!account) {
      account = { name: row.accounts?.name ?? 'Cliente removido', cost: 0, conversations: new Set() }
      perAccount.set(row.account_id, account)
    }
    account.cost += toNumber(row.cost_brl)
    // A mesma conversa gera uma linha por resposta da Clara — contar linhas em
    // vez de conversas distintas faria toda conta movimentada parecer em loop.
    if (row.related_id) account.conversations.add(row.related_id)
  }

  const alerts: CostAlert[] = []
  for (const [accountId, account] of perAccount) {
    const conversations = account.conversations.size
    if (conversations < MIN_CONVERSATIONS_FOR_ALERT) continue

    const perConversation = account.cost / conversations
    if (perConversation <= COST_PER_CONVERSATION_ALERT_BRL) continue

    alerts.push({
      kind: 'custo_por_conversa',
      accountId,
      accountName: account.name,
      cost: account.cost,
      detail: `${perConversation.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })} por conversa em ${conversations} conversas`,
    })
  }

  return alerts.sort((a, b) => b.cost - a.cost)
}
