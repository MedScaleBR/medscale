import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPromptParts, wrapPatientMessage } from '@/lib/bot/prompt-builder'
import { recordClaudeCost } from '@/lib/costs/record'
import type { AgentContext } from '@/lib/llm/agent-context'

// Etapa 2 do agente: montar o prompt e chamar o Claude. Igual na produção e no
// simulador — muda só a origem do custo em cost_events.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const BOT_MODEL = 'claude-sonnet-5-5'
export const NO_REPLY_FALLBACK = 'Não consegui processar sua mensagem. Pode repetir?'

export interface ClaudeTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface RawReply {
  systemPrompt: string
  messages: ClaudeTurn[]
  /** Resposta crua do Claude, com marcadores (ou o fallback se veio vazia). */
  raw: string
  /** Soma das tentativas. input_tokens é só a entrada sem cache. */
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
    cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number }
  }
  model: string
}

export function buildAgentPrompt(ctx: AgentContext): { stable: string; dynamic: string } {
  return buildSystemPromptParts({
    accountName: ctx.accountName,
    config: ctx.botConfig,
    units: ctx.units.map((u) => ({
      id: u.id,
      name: u.name,
      address: u.address,
      businessHours: u.businessHours,
      workingDays: u.workingDays,
      extraDates: u.extraDates,
      scheduleRules: u.scheduleRules,
      blockedDates: u.blockedDates,
      bookingOpenUntil: u.bookingOpenUntil,
      directionsParking: u.directionsParking,
      contactInfo: u.contactInfo,
      isOutsourced: u.isOutsourced,
      botSettings: u.botSettings,
      coverage: ctx.coverageByUnit[u.id],
    })),
    freeSlotsByUnit: ctx.freeSlotsByUnit,
    procedureCatalogByUnit: ctx.procedureCatalogByUnit,
    insurancePlans: ctx.insurers.map((i) => i.name),
    insurers: ctx.insurers,
    isFirstMessage: ctx.isFirstMessage,
    upcomingAppointments: ctx.upcomingAppointments,
    upcomingAppointmentsAvailable: ctx.upcomingAppointmentsAvailable,
    now: ctx.now,
    currentUnitName: ctx.currentUnitId ? (ctx.unitById.get(ctx.currentUnitId)?.name ?? null) : null,
    waitlistEnabled: ctx.waitlistEnabled,
  })
}

// Só o turno do paciente vai delimitado — a fala do próprio bot não é
// conteúdo não confiável.
export function buildClaudeMessages(ctx: AgentContext): ClaudeTurn[] {
  return ctx.history.map((m) => {
    const timestamp = m.sent_at && !Number.isNaN(new Date(m.sent_at).getTime())
      ? `[Mensagem enviada em ${new Date(m.sent_at).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
        })} (America/Sao_Paulo)]\n`
      : '[Mensagem sem data registrada; referências como "amanhã" não determinam a data atual.]\n'
    return {
      role: m.role,
      content: timestamp + (m.role === 'user' ? wrapPatientMessage(m.content) : m.content),
    }
  })
}

export async function generateReply(
  ctx: AgentContext,
  opts: { costProvider: 'claude_agendamento' | 'claude_simulador'; costMetadata?: Record<string, unknown> }
): Promise<RawReply> {
  const prompt = buildAgentPrompt(ctx)
  const systemPrompt = prompt.stable + prompt.dynamic
  const messages = buildClaudeMessages(ctx)
  const usage: RawReply['usage'] = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  }

  let responseText: string | null = null
  for (let attempt = 1; attempt <= 2 && responseText === null; attempt++) {
    const response = await anthropic.messages.create({
      model: BOT_MODEL,
      // O raciocínio interno conta dentro de max_tokens; esforço baixo basta
      // para conversa e mantém custo e tempo de resposta sob controle.
      max_tokens: 4096,
      output_config: { effort: 'low' },
      // A parte fixa é igual para todo paciente da clínica: fica no cache e
      // sai a 5% do preço. Cache de 1 h porque 93% das respostas chegam em até
      // 1 h da anterior na mesma clínica, e só 72% em até 5 min (prod, nov/2026).
      system: [
        { type: 'text', text: prompt.stable, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: prompt.dynamic },
      ],
      messages,
    })
    usage.input_tokens += response.usage?.input_tokens ?? 0
    usage.output_tokens += response.usage?.output_tokens ?? 0
    usage.cache_read_input_tokens += response.usage?.cache_read_input_tokens ?? 0
    usage.cache_creation_input_tokens += response.usage?.cache_creation_input_tokens ?? 0
    usage.cache_creation.ephemeral_5m_input_tokens += response.usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0
    usage.cache_creation.ephemeral_1h_input_tokens += response.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0

    // Dentro do laço: a segunda tentativa é cobrada igual à primeira, e é
    // justamente o retry repetido que denuncia bot mal configurado no painel.
    await recordClaudeCost({
      ctx: { accountId: ctx.accountId, workspaceId: ctx.conversation.workspace_id },
      provider: opts.costProvider,
      model: BOT_MODEL,
      usage: response.usage,
      relatedId: ctx.conversation.id,
      ...(opts.costMetadata ? { metadata: opts.costMetadata } : {}),
    })

    // O Sonnet 5.5 devolve um bloco de raciocínio antes do texto — por isso
    // procura o bloco de texto em vez de assumir que ele vem primeiro.
    const textBlock = response.content.find((b) => b.type === 'text')
    if (textBlock?.type === 'text' && textBlock.text.trim()) {
      responseText = textBlock.text
    } else {
      console.error(`Claude não retornou um bloco de texto (tentativa ${attempt}/2)`, {
        accountId: ctx.accountId,
        conversationId: ctx.conversation.id,
        stopReason: response.stop_reason,
        contentTypes: response.content.map((b) => b.type),
      })
    }
  }

  return { systemPrompt, messages, raw: responseText ?? NO_REPLY_FALLBACK, usage, model: BOT_MODEL }
}
