import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveCategoryPair, type FinanceCategoryTree } from './categories'
import { resolveReserveByName, reserveBalance } from './reserves'
import { resolveGoalByName, calculateGoalStatus } from './goals'
import { calculateInvestmentProjection } from './investments'
import { loadGoalContext, loadReserves } from './patrimonio-queries'
import {
  buildReserveMovementMessage,
  buildReserveNotFoundMessage,
  buildReserveAmbiguousMessage,
  buildReserveNameNeededMessage,
  buildAskReserveAmountMessage,
  buildReserveCreateCancelledMessage,
  buildInvestmentRegisteredMessage,
  buildAskInvestmentAmountMessage,
  buildProjectionSavedMessage,
  buildAskProjectionAmountMessage,
  buildGoalStatusMessage,
  buildGoalNotFoundMessage,
  buildCategoryNotFoundMessage,
  type GoalLine,
} from './respond'
import type { FinanceEntryType, FinanceIntent, ReserveMovementType } from './types'

// Execução dos intents de patrimônio vindos do WhatsApp. Fica fora de agent.ts
// porque são cinco fluxos independentes do laço de lançamentos; aqui nada é
// enviado — os handlers devolvem o texto e a pendência, e quem fala com o
// WhatsApp continua sendo o agente.
//
// Nenhum valor financeiro entra em log daqui: são dados pessoais do médico
// (mesma regra já aplicada a finance_entries).

type Client = SupabaseClient<Database>

export interface PatrimonioCtx {
  accountId: string
  categoryTree: FinanceCategoryTree
  // 'YYYY-MM-DD' de hoje, já na timezone do agente.
  today: string
}

// Movimento de reserva parado numa pergunta: ou falta o valor, ou falta o
// "sim" para criar uma caixinha que não existe. Guardado em
// finance_sessions.pending_entry entre as duas mensagens.
export interface PendingReserveMovement {
  kind: 'reserve_movement'
  awaiting: 'amount' | 'create_confirm'
  movement: ReserveMovementType
  reserveId: string | null
  reserveName: string | null
  entryKind: FinanceEntryType
  amount: number | null
}

export interface PatrimonioResult {
  reply: string
  // undefined = não mexe na sessão; null = limpa; objeto = grava a pendência.
  pending?: PendingReserveMovement | null
}

const currentMonth = (today: string) => today.slice(0, 7)

// ── Reservas ──────────────────────────────────────────────────────────────

async function recordMovement(
  supabase: Client,
  accountId: string,
  reserve: { id: string; name: string },
  movement: ReserveMovementType,
  amount: number
): Promise<PatrimonioResult> {
  await supabase.from('finance_reserve_movements').insert({
    account_id: accountId,
    reserve_id: reserve.id,
    amount,
    type: movement,
    source: 'whatsapp',
  })

  const { data: movements } = await supabase
    .from('finance_reserve_movements')
    .select('*')
    .eq('reserve_id', reserve.id)

  return {
    reply: buildReserveMovementMessage(reserve.name, movement, amount, reserveBalance(movements ?? [])),
    pending: null,
  }
}

async function handleReserveIntent(
  supabase: Client,
  ctx: PatrimonioCtx,
  movement: ReserveMovementType,
  intent: { reserve: string | null; amount: number | null; type: FinanceEntryType | null }
): Promise<PatrimonioResult> {
  const entryKind: FinanceEntryType = intent.type ?? 'pf'
  const reserves = await loadReserves(supabase, ctx.accountId)

  if (!intent.reserve) {
    return { reply: buildReserveNameNeededMessage(reserves), pending: null }
  }

  const match = resolveReserveByName(reserves, intent.reserve)

  if (match.status === 'many') {
    return { reply: buildReserveAmbiguousMessage(match.reserves), pending: null }
  }

  // Não achou: pergunta antes de criar. Criar calado com o nome falado
  // encheria a conta de caixinhas quase iguais ("viagem", "viagens").
  if (match.status === 'none') {
    return {
      reply: buildReserveNotFoundMessage(intent.reserve, reserves),
      pending: {
        kind: 'reserve_movement',
        awaiting: 'create_confirm',
        movement,
        reserveId: null,
        reserveName: intent.reserve,
        entryKind,
        amount: intent.amount,
      },
    }
  }

  if (intent.amount == null) {
    return {
      reply: buildAskReserveAmountMessage(match.reserve.name, movement),
      pending: {
        kind: 'reserve_movement',
        awaiting: 'amount',
        movement,
        reserveId: match.reserve.id,
        reserveName: match.reserve.name,
        entryKind,
        amount: null,
      },
    }
  }

  return recordMovement(supabase, ctx.accountId, match.reserve, movement, intent.amount)
}

// Continua um movimento de reserva estacionado. `amount` vem já parseado pelo
// agente (parseAmount), e `affirmative`/`negative` também, para este módulo não
// duplicar a leitura de texto livre que já existe lá.
export async function resumeReserveMovement(
  supabase: Client,
  ctx: PatrimonioCtx,
  pending: PendingReserveMovement,
  answer: { amount: number | null; affirmative: boolean; negative: boolean }
): Promise<PatrimonioResult | null> {
  if (pending.awaiting === 'create_confirm') {
    if (answer.negative) {
      return { reply: buildReserveCreateCancelledMessage(), pending: null }
    }
    if (!answer.affirmative) return null

    const { data: created } = await supabase
      .from('finance_reserves')
      .insert({
        account_id: ctx.accountId,
        kind: pending.entryKind,
        name: pending.reserveName ?? 'Reserva',
      })
      .select('id, name')
      .single()

    if (!created) {
      return { reply: 'Não consegui criar a reserva agora. Tenta de novo daqui a pouco?', pending: null }
    }

    if (pending.amount == null) {
      return {
        reply: `Criei a reserva ${created.name}. ${buildAskReserveAmountMessage(created.name, pending.movement)}`,
        pending: { ...pending, awaiting: 'amount', reserveId: created.id, reserveName: created.name },
      }
    }

    const done = await recordMovement(supabase, ctx.accountId, created, pending.movement, pending.amount)
    return { ...done, reply: `Criei a reserva ${created.name}.\n${done.reply}` }
  }

  // awaiting 'amount'
  if (answer.negative) {
    return { reply: buildReserveCreateCancelledMessage(), pending: null }
  }
  if (answer.amount == null || !pending.reserveId) return null

  return recordMovement(
    supabase,
    ctx.accountId,
    { id: pending.reserveId, name: pending.reserveName ?? 'Reserva' },
    pending.movement,
    answer.amount
  )
}

// ── Investimentos ─────────────────────────────────────────────────────────

async function handleInvestment(
  supabase: Client,
  ctx: PatrimonioCtx,
  intent: Extract<FinanceIntent, { kind: 'investment' }>
): Promise<PatrimonioResult> {
  if (intent.amount == null) {
    return { reply: buildAskInvestmentAmountMessage(intent.name), pending: null }
  }

  const name = intent.name ?? 'Investimento'
  const { data: created } = await supabase
    .from('finance_investments')
    .insert({
      account_id: ctx.accountId,
      kind: intent.type ?? 'pf',
      name,
      type: intent.investmentType ?? 'outro',
      invested_amount: intent.amount,
      // Taxa só entra completa. Meia taxa viraria projeção sem base — e o
      // produto não estima rendimento que o médico não disse.
      rate_type: intent.rateType && intent.rateValue != null ? intent.rateType : null,
      rate_value: intent.rateType && intent.rateValue != null ? intent.rateValue : null,
      start_date: ctx.today,
    })
    .select('*')
    .single()

  const projection = created ? calculateInvestmentProjection(created) : null
  return { reply: buildInvestmentRegisteredMessage(name, intent.amount, projection), pending: null }
}

// ── Projeções ─────────────────────────────────────────────────────────────

async function handleProjection(
  supabase: Client,
  ctx: PatrimonioCtx,
  intent: Extract<FinanceIntent, { kind: 'projection' }>
): Promise<PatrimonioResult> {
  // Mesma resolução nome->id das consultas e lançamentos: a categoria da
  // projeção tem que ser uma da árvore do médico, senão a comparação com o
  // realizado não fecha.
  const pair = resolveCategoryPair(ctx.categoryTree, intent.type, intent.category, intent.subcategory, 'out')

  if (!pair.categoryId) {
    return { reply: buildCategoryNotFoundMessage(intent.category ?? ''), pending: null }
  }

  const path = pair.subcategoryName ? `${pair.categoryName} > ${pair.subcategoryName}` : pair.categoryName ?? ''

  if (intent.amount == null) {
    return { reply: buildAskProjectionAmountMessage(path), pending: null }
  }

  const month = intent.month ?? currentMonth(ctx.today)
  const periodMonth = `${month}-01`

  let existing = supabase
    .from('finance_projections')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('category_id', pair.categoryId)
    .eq('period_month', periodMonth)
  existing = pair.subcategoryId
    ? existing.eq('subcategory_id', pair.subcategoryId)
    : existing.is('subcategory_id', null)
  const { data: current } = await existing.maybeSingle()

  if (current) {
    await supabase
      .from('finance_projections')
      .update({ projected_amount: intent.amount })
      .eq('id', current.id)
  } else {
    await supabase.from('finance_projections').insert({
      account_id: ctx.accountId,
      category_id: pair.categoryId,
      subcategory_id: pair.subcategoryId,
      period_month: periodMonth,
      projected_amount: intent.amount,
    })
  }

  // Quanto já saiu nessa categoria no mês — é a informação que dá sentido ao
  // teto que ele acabou de definir.
  let realizedQuery = supabase
    .from('finance_entries')
    .select('amount')
    .eq('account_id', ctx.accountId)
    .eq('direction', 'out')
    .eq('category_id', pair.categoryId)
    .gte('entry_date', periodMonth)
    .lte('entry_date', `${month}-31`)
  if (pair.subcategoryId) realizedQuery = realizedQuery.eq('subcategory_id', pair.subcategoryId)
  const { data: entries } = await realizedQuery
  const realized = (entries ?? []).reduce((sum, e) => sum + e.amount, 0)

  return {
    reply: buildProjectionSavedMessage(path, intent.amount, month, realized),
    pending: null,
  }
}

// ── Metas ─────────────────────────────────────────────────────────────────

async function handleGoalQuery(
  supabase: Client,
  ctx: PatrimonioCtx,
  intent: Extract<FinanceIntent, { kind: 'goal_query' }>
): Promise<PatrimonioResult> {
  const { data: goals } = await supabase
    .from('finance_goals')
    .select('*')
    .eq('account_id', ctx.accountId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const list = goals ?? []
  if (list.length === 0) {
    return { reply: buildGoalNotFoundMessage(intent.goal, []), pending: null }
  }

  const chosen = intent.goal ? resolveGoalByName(list, intent.goal) : list
  if (chosen.length === 0) {
    return { reply: buildGoalNotFoundMessage(intent.goal, list), pending: null }
  }

  // Status sempre recalculado na leitura: meta automática acompanha as
  // projeções e os saldos de agora, não um número congelado no banco.
  const goalCtx = await loadGoalContext(supabase, ctx.accountId, currentMonth(ctx.today))
  const lines: GoalLine[] = chosen.map((goal) => {
    const status = calculateGoalStatus(goal, goalCtx)
    return {
      name: goal.name,
      currentSaved: status.currentSaved,
      requiredTotal: status.requiredTotal,
      remaining: status.remaining,
      monthlyRequired: status.monthlyRequired,
      progressPct: status.progressPct,
    }
  })

  return { reply: buildGoalStatusMessage(lines), pending: null }
}

// ── Roteamento ────────────────────────────────────────────────────────────

/** Intents de patrimônio; null para qualquer outro intent (o agente segue o fluxo normal). */
export async function handlePatrimonioIntent(
  supabase: Client,
  ctx: PatrimonioCtx,
  intent: FinanceIntent
): Promise<PatrimonioResult | null> {
  switch (intent.kind) {
    case 'reserve_deposit':
      return handleReserveIntent(supabase, ctx, 'deposit', intent)
    case 'reserve_withdrawal':
      return handleReserveIntent(supabase, ctx, 'withdrawal', intent)
    case 'investment':
      return handleInvestment(supabase, ctx, intent)
    case 'projection':
      return handleProjection(supabase, ctx, intent)
    case 'goal_query':
      return handleGoalQuery(supabase, ctx, intent)
    default:
      return null
  }
}
