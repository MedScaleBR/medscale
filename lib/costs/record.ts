import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import {
  USD_BRL,
  claudeCostUsd,
  isKnownClaudeModel,
  toBrl,
  whatsappConversationCostBrl,
  whisperCostUsd,
} from './pricing'

// Captura de custo. A regra que manda em tudo aqui: registrar custo NUNCA
// pode quebrar nem atrasar o fluxo principal. Um paciente sem resposta, um
// prontuário que não gera ou um lançamento que não entra são incidentes
// reais; uma linha de custo perdida é só um número levemente baixo no painel
// interno. Por isso todo insert é try/catch silencioso, com o erro indo só
// para o Sentry.

export type CostProvider =
  | 'claude_agendamento'
  | 'claude_financeiro'
  | 'claude_soap'
  | 'whisper'
  | 'whatsapp_conversation'

/** Etapa técnica dentro de um mesmo provider — só vai para metadata. */
export type CostStage = 'interpret' | 'respond' | 'categorize'

export interface CostContext {
  accountId: string
  /** Null quando a unidade ainda não é conhecida (conta multi-unidade). */
  workspaceId?: string | null
}

interface RecordCostInput extends CostContext {
  provider: CostProvider
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  quantity?: number | null
  costBrl: number
  relatedId?: string | null
  metadata?: Record<string, unknown>
}

async function insertCostEvent(input: RecordCostInput): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('cost_events').insert({
      account_id: input.accountId,
      workspace_id: input.workspaceId ?? null,
      provider: input.provider,
      model: input.model ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      quantity: input.quantity ?? null,
      cost_brl: input.costBrl,
      related_id: input.relatedId ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'costs', provider: input.provider } })
  }
}

/** Formato mínimo do usage da resposta do Claude — evita acoplar ao SDK. */
export interface ClaudeUsage {
  input_tokens?: number | null
  output_tokens?: number | null
}

/**
 * Registra uma chamada ao Claude. `stage` distingue as etapas do agente
 * financeiro (interpret/respond/categorize) sem multiplicar providers: o
 * painel soma um número só por provider e a quebra fica em metadata.
 */
export async function recordClaudeCost(params: {
  ctx: CostContext
  provider: Extract<CostProvider, 'claude_agendamento' | 'claude_financeiro' | 'claude_soap'>
  model: string
  usage: ClaudeUsage | null | undefined
  relatedId?: string | null
  stage?: CostStage
}): Promise<void> {
  const inputTokens = params.usage?.input_tokens ?? 0
  const outputTokens = params.usage?.output_tokens ?? 0
  // Resposta sem usage não gera linha: zero token registrado seria indistinguível
  // de uma chamada barata de verdade e sujaria a média por conversa.
  if (inputTokens === 0 && outputTokens === 0) return

  const usd = claudeCostUsd(params.model, inputTokens, outputTokens)

  await insertCostEvent({
    ...params.ctx,
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    costBrl: toBrl(usd),
    relatedId: params.relatedId ?? null,
    metadata: {
      usd,
      fx: USD_BRL,
      ...(params.stage ? { stage: params.stage } : {}),
      // Marca o custo calculado por fallback — no painel, um preço de modelo
      // desconhecido é a explicação mais provável de um número fora da curva.
      ...(isKnownClaudeModel(params.model) ? {} : { unknown_model: true }),
    },
  })
}

/** Registra uma transcrição do Whisper, cobrada pela duração do áudio. */
export async function recordWhisperCost(params: {
  ctx: CostContext
  durationSeconds: number
  transcriptionId: string
}): Promise<void> {
  if (!params.durationSeconds || params.durationSeconds <= 0) return

  const usd = whisperCostUsd(params.durationSeconds)

  await insertCostEvent({
    ...params.ctx,
    provider: 'whisper',
    model: 'whisper-1',
    quantity: params.durationSeconds,
    costBrl: toBrl(usd),
    relatedId: params.transcriptionId,
    metadata: { usd, fx: USD_BRL },
  })
}

/**
 * Registra a abertura de uma janela de 24h do WhatsApp, e devolve se gravou.
 *
 * Só conta quando a MedScale provisiona o número (number_source='medscale') —
 * com o App Meta da própria clínica ('own'), quem paga a Meta é a clínica e o
 * custo não é nosso. A janela é de 24h por conversa: mensagens seguintes do
 * mesmo paciente dentro dela não abrem cobrança nova, então só grava se não
 * houver evento da mesma conversa nas últimas 24 horas.
 */
export async function recordWhatsappConversation(params: {
  ctx: CostContext
  conversationId: string
}): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: existing } = await supabase
      .from('cost_events')
      .select('id')
      .eq('provider', 'whatsapp_conversation')
      .eq('related_id', params.conversationId)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle()

    if (existing) return false
  } catch (err) {
    // Falha na checagem não pode abrir a porta para cobrança duplicada no
    // painel — não grava e segue.
    Sentry.captureException(err, { tags: { area: 'costs', provider: 'whatsapp_conversation' } })
    return false
  }

  await insertCostEvent({
    ...params.ctx,
    provider: 'whatsapp_conversation',
    quantity: 1,
    costBrl: whatsappConversationCostBrl(),
    relatedId: params.conversationId,
    metadata: { brl_per_conversation: whatsappConversationCostBrl() },
  })
  return true
}
