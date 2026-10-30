import Anthropic from '@anthropic-ai/sdk'
import { buildDynamicSystemPrompt, wrapPatientMessage } from '@/lib/bot/prompt-builder'
import { recordClaudeCost } from '@/lib/costs/record'
import type { AgentContext } from '@/lib/llm/agent-context'

// Etapa 2 do agente: montar o prompt e chamar o Claude. Igual na produção e no
// simulador — muda só a origem do custo em cost_events.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const BOT_MODEL = 'claude-sonnet-4-5'
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
  usage: { input_tokens: number; output_tokens: number }
  model: string
}

export function buildAgentPrompt(ctx: AgentContext): string {
  return buildDynamicSystemPrompt({
    accountName: ctx.accountName,
    config: ctx.botConfig,
    units: ctx.units.map((u) => ({
      id: u.id,
      name: u.name,
      address: u.address,
      businessHours: u.businessHours,
      workingDays: u.workingDays,
      extraDates: u.extraDates,
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
  const systemPrompt = buildAgentPrompt(ctx)
  const messages = buildClaudeMessages(ctx)
  const usage = { input_tokens: 0, output_tokens: 0 }

  let responseText: string | null = null
  for (let attempt = 1; attempt <= 2 && responseText === null; attempt++) {
    const response = await anthropic.messages.create({
      model: BOT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })
    usage.input_tokens += response.usage?.input_tokens ?? 0
    usage.output_tokens += response.usage?.output_tokens ?? 0

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

    if (response.content[0]?.type === 'text' && response.content[0].text.trim()) {
      responseText = response.content[0].text
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
