import { createAdminClient } from '@/lib/supabase/server'
import { getBotConfig, type BotConfig } from '@/lib/bot/config'
import { getWorkspaceBotSettings, parseBotSettingsBody, type BotSettingsUpdate } from '@/lib/bot/unit-settings'
import { claudeCostUsd } from '@/lib/costs/pricing'
import { buildAgentContext, loadAccountUnits, type HistoryMessage, type StoredIntake } from '@/lib/llm/agent-context'
import { generateReply } from '@/lib/llm/agent-reply'
import { planEffects, type AgentEffect } from '@/lib/llm/agent-plan'
import { describeEffect } from '@/lib/bot/simulator-format'

// Simulador da Clara (/admin): roda as mesmas etapas da produção — contexto,
// Claude, plano — e NUNCA a execução. Por construção, este arquivo não importa
// nada que grave no banco, envie WhatsApp, escreva no Google Calendar ou mande
// push: o único registro é o custo da chamada ao Claude (cost_events,
// provider 'claude_simulador'). Leituras reais (horários, convênios, catálogo)
// são permitidas para o teste ser fiel.

// Id fixo do paciente fictício. Nunca é consultado: AgentPatient.persisted = false.
const SIMULATED_PATIENT_ID = '00000000-0000-4000-8000-000000000000'
const SIMULATED_PHONE = '5500000000000'
const MAX_TEXT = 4000
const MAX_HISTORY = 60
export const SIMULATOR_RATE_LIMIT = 30
export const SIMULATOR_RATE_WINDOW_SECONDS = 60

// Account sem Clara configurada (sem linha em bot_config): o simulador usa os
// padrões do schema para dar para testar antes de configurar. Só aqui — a
// produção continua exigindo a configuração.
const DEFAULT_BOT_CONFIG: BotConfig = {
  specialty: null,
  acceptsPrivate: true,
  paymentMethods: [],
  pricingInfo: null,
  examPreparation: null,
  policies: null,
  toneOfVoice: null,
  handoffInstructions: null,
  forbiddenActions: null,
  faq: [],
  handoffMessage: 'Vou te conectar com nossa equipe agora. Um momento!',
  welcomeMessage: 'Olá! Posso ajudar com agendamentos e informações. Como posso ajudar?',
  outOfHoursMessage:
    'No momento nossa equipe não está disponível para atendimento humano — já registrei sua mensagem e vamos retornar assim que possível. Enquanto isso, posso continuar te ajudando por aqui!',
  isActive: false,
  phoneNumberId: null,
  metaToken: null,
  numberSource: 'medscale',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SimulatedPatient {
  full_name: string | null
  fields: {
    birth_date?: string | null
    insurance?: { convenio_id: string | null; card_number: string | null } | null
    cpf?: string | null
    email?: string | null
  }
}

export interface SimulationTurn {
  role: 'patient' | 'clara'
  text: string
  sent_at?: string | null
}

export interface SimulationInput {
  account_id: string
  draft_settings: Record<string, BotSettingsUpdate>
  simulated_now: string | null
  patient: SimulatedPatient
  conversation_unit_id: string | null
  history: SimulationTurn[]
  message: string
}

export interface SimulationResult {
  reply: string
  /** Tudo o que o paciente receberia pelo WhatsApp, em ordem. */
  outgoing: string[]
  raw: string
  prompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  plan: AgentEffect[]
  plan_text: string[]
  patient: SimulatedPatient
  conversation_unit_id: string | null
  /** Data usada como "agora" (ISO). */
  now: string
  notes: string[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const str = (v: unknown, max = MAX_TEXT): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

/** Valida o corpo do POST /api/admin/clara/simulate. */
export function parseSimulationInput(body: unknown): ParseResult<SimulationInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Corpo inválido' }
  const b = body as Record<string, unknown>

  const accountId = typeof b.account_id === 'string' && UUID.test(b.account_id) ? b.account_id : null
  if (!accountId) return { ok: false, error: 'Escolha a account' }

  const message = str(b.message)
  if (!message) return { ok: false, error: 'Escreva a mensagem do paciente' }

  let simulatedNow: string | null = null
  if (b.simulated_now != null && b.simulated_now !== '') {
    const d = typeof b.simulated_now === 'string' ? new Date(b.simulated_now) : null
    if (!d || Number.isNaN(d.getTime())) return { ok: false, error: 'Data simulada inválida' }
    simulatedNow = d.toISOString()
  }

  const drafts: Record<string, BotSettingsUpdate> = {}
  if (b.draft_settings != null) {
    if (typeof b.draft_settings !== 'object') return { ok: false, error: 'Rascunho inválido' }
    for (const [workspaceId, raw] of Object.entries(b.draft_settings as Record<string, unknown>)) {
      if (!UUID.test(workspaceId)) return { ok: false, error: 'Rascunho com unidade inválida' }
      const parsed = parseBotSettingsBody(raw)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      drafts[workspaceId] = parsed.value
    }
  }

  const history: SimulationTurn[] = []
  if (b.history != null) {
    if (!Array.isArray(b.history)) return { ok: false, error: 'Histórico inválido' }
    for (const turn of b.history.slice(-MAX_HISTORY)) {
      const t = turn as Record<string, unknown>
      if (t?.role !== 'patient' && t?.role !== 'clara') return { ok: false, error: 'Histórico inválido' }
      const text = typeof t.text === 'string' ? t.text.slice(0, MAX_TEXT) : ''
      const sentAt = typeof t.sent_at === 'string' && !Number.isNaN(new Date(t.sent_at).getTime()) ? t.sent_at : null
      history.push({ role: t.role, text, sent_at: sentAt })
    }
  }

  const p = (b.patient ?? {}) as Record<string, unknown>
  const f = (p.fields ?? {}) as Record<string, unknown>
  const ins = (f.insurance ?? null) as Record<string, unknown> | null
  const patient: SimulatedPatient = {
    full_name: str(p.full_name, 200),
    fields: {
      birth_date: typeof f.birth_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.birth_date) ? f.birth_date : null,
      insurance: ins ? { convenio_id: str(ins.convenio_id, 64), card_number: str(ins.card_number, 64) } : null,
      cpf: str(f.cpf, 20),
      email: str(f.email, 200),
    },
  }

  const unitId = typeof b.conversation_unit_id === 'string' && UUID.test(b.conversation_unit_id) ? b.conversation_unit_id : null

  return {
    ok: true,
    value: { account_id: accountId, draft_settings: drafts, simulated_now: simulatedNow, patient, conversation_unit_id: unitId, history, message },
  }
}

export class SimulationError extends Error {}

export async function runSimulation(input: SimulationInput, opts: { staffUserId: string }): Promise<SimulationResult> {
  const supabase = createAdminClient()
  const accountId = input.account_id
  const notes: string[] = []

  const savedConfig = await getBotConfig(accountId)
  const botConfig = savedConfig ?? DEFAULT_BOT_CONFIG
  if (!savedConfig) {
    notes.push('Esta account ainda não tem a Clara configurada: usando a configuração padrão (sem especialidade, FAQ nem políticas).')
  } else if (!botConfig.isActive) {
    notes.push('A Clara está desligada nesta account: em produção ela não responderia.')
  }
  const channelReady = Boolean(botConfig.phoneNumberId && botConfig.metaToken)
  if (!channelReady) notes.push('A account não tem WhatsApp conectado: em produção nada seria enviado e não haveria transferência.')

  const account = await loadAccountUnits(supabase, accountId)
  if (account.units.length === 0) throw new SimulationError('Esta account não tem unidades ativas.')

  // Rascunho por unidade: só vale para unidades desta account, só nesta simulação.
  const units = account.units.map((u) =>
    input.draft_settings[u.id] ? { ...u, botSettings: getWorkspaceBotSettings(input.draft_settings[u.id]) } : u
  )

  const now = input.simulated_now ? new Date(input.simulated_now) : new Date()
  const single = units.length === 1 ? units[0].id : null
  const conversationUnitId =
    input.conversation_unit_id && units.some((u) => u.id === input.conversation_unit_id) ? input.conversation_unit_id : single

  // Mesmo recorte da produção: as 20 mais recentes, sem começar pela Clara.
  const all: HistoryMessage[] = [
    ...input.history.map((t) => ({ role: t.role === 'patient' ? ('user' as const) : ('assistant' as const), content: t.text, sent_at: t.sent_at ?? null })),
    { role: 'user', content: input.message, sent_at: now.toISOString() },
  ]
  const recent = all.slice(-20)
  const history = recent[0]?.role === 'assistant' ? recent.slice(1) : recent

  const storedIntake: StoredIntake = {
    cpf: input.patient.fields.cpf ?? null,
    email: input.patient.fields.email ?? null,
    insurance_card_number: input.patient.fields.insurance?.card_number ?? null,
  }

  const ctx = await buildAgentContext({
    supabase,
    accountId,
    botConfig,
    account: { ...account, units },
    patientPhone: SIMULATED_PHONE,
    patient: {
      id: SIMULATED_PATIENT_ID,
      full_name: input.patient.full_name ?? 'Paciente',
      birth_date: input.patient.fields.birth_date ?? null,
      persisted: false,
    },
    storedIntake,
    conversation: { id: null, workspace_id: conversationUnitId },
    message: input.message,
    history,
    now,
    channelReady,
  })

  const reply = await generateReply(ctx, {
    costProvider: 'claude_simulador',
    costMetadata: { source: 'simulator', staff_user_id: opts.staffUserId },
  })
  const plan = await planEffects(ctx, reply.raw)

  // "Aplica" o plano só no paciente fictício da resposta.
  const patient: SimulatedPatient = {
    full_name: input.patient.full_name,
    fields: { ...input.patient.fields },
  }
  for (const effect of plan.effects) {
    if (effect.kind !== 'save_patient_field') continue
    if (effect.field === 'full_name') patient.full_name = effect.value
    else if (effect.field === 'birth_date') patient.fields.birth_date = effect.value
    else if (effect.field === 'cpf') patient.fields.cpf = effect.value
    else if (effect.field === 'email') patient.fields.email = effect.value
    else if (effect.field === 'insurance_card_number') {
      patient.fields.insurance = { convenio_id: patient.fields.insurance?.convenio_id ?? null, card_number: effect.value }
    }
  }
  const choice = plan.markers.insuranceChoice
  if (choice && (choice === 'PARTICULAR' || ctx.insurers.some((i) => i.id.toLowerCase() === choice.toLowerCase()))) {
    patient.fields.insurance = { convenio_id: choice, card_number: patient.fields.insurance?.card_number ?? null }
  }

  const booked = plan.effects.find((e) => e.kind === 'book' || e.kind === 'handoff')
  const nextUnitId = booked && 'workspace_id' in booked ? booked.workspace_id : plan.conversationUnitId

  const costUsd = claudeCostUsd(reply.model, reply.usage.input_tokens, reply.usage.output_tokens)

  // Só metadados — nunca o texto da conversa nem o prompt (LGPD).
  console.log(
    `[simulador] account=${accountId} mensagens=${history.length} tokens_in=${reply.usage.input_tokens} tokens_out=${reply.usage.output_tokens}`
  )

  return {
    reply: plan.reply,
    outgoing: plan.outgoing,
    raw: reply.raw,
    prompt: reply.systemPrompt,
    messages: reply.messages,
    plan: plan.effects,
    plan_text: plan.effects.map(describeEffect),
    patient,
    conversation_unit_id: nextUnitId ?? null,
    now: now.toISOString(),
    notes,
    usage: { input_tokens: reply.usage.input_tokens, output_tokens: reply.usage.output_tokens, cost_usd: costUsd },
  }
}
