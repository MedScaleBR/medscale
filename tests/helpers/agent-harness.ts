import { vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from './supabase-mock'
import type { BotConfig } from '@/lib/bot/config'

// Estado compartilhado entre o arquivo de teste e as factories de vi.mock.
// As factories fazem `await import()` deste módulo (ver os testes em
// tests/agent/*) porque vi.mock é hoisted acima dos imports estáticos.
export const state = {
  supabase: null as unknown as SupabaseMock,
  botConfig: null as BotConfig | null,
  /** Respostas do Claude, consumidas em ordem a cada messages.create. */
  claudeResponses: [] as Array<string | { content: unknown[]; stop_reason?: string }>,
  freeSlots: {} as Record<string, string[]>,
  slotAvailable: true,
  googleConnected: false,
  googleEmail: null as string | null,
  /** Erro a lançar em createEvent (simula falha do Google Calendar). */
  createEventError: null as Error | null,
}

export const sendWhatsAppMessage = vi.fn(async () => ({ ok: true }))
export const createEvent = vi.fn(async () => {
  if (state.createEventError) throw state.createEventError
  return { id: 'gcal-event-1' }
})
export const cancelEvent = vi.fn(async () => undefined)
export const isSlotAvailable = vi.fn(async () => state.slotAvailable)
export const getFreeSlotsForBot = vi.fn(async (_workspaceId: string, date: Date) => {
  const key = date.toISOString().slice(0, 10)
  return state.freeSlots[key] ?? state.freeSlots['*'] ?? []
})
export const claudeCreate = vi.fn(async () => {
  const next = state.claudeResponses.shift()
  if (next === undefined) return { content: [{ type: 'text', text: 'Resposta padrão do teste.' }], stop_reason: 'end_turn' }
  if (typeof next === 'string') return { content: [{ type: 'text', text: next }], stop_reason: 'end_turn' }
  return { stop_reason: 'end_turn', ...next }
})

export const DEFAULT_BOT_CONFIG: BotConfig = {
  specialty: 'Ortopedia',
  procedures: [],
  insurancePlans: [],
  acceptsPrivate: true,
  consultationPriceFrom: null,
  businessHours: null,
  address: null,
  directionsParking: null,
  contactInfo: null,
  paymentMethods: [],
  pricingInfo: null,
  examPreparation: null,
  policies: null,
  toneOfVoice: null,
  handoffInstructions: null,
  forbiddenActions: null,
  faq: [],
  handoffNumber: '+5511999998888',
  handoffMessage: 'Vou te transferir para a equipe.',
  welcomeMessage: 'Olá! Bem-vindo à clínica.',
  outOfHoursMessage: 'Nossa equipe responde no próximo horário comercial.',
  isActive: true,
}

export const PATIENT = { id: 'p1', full_name: 'Paciente' }
export const CONVERSATION = { id: 'c1', status: 'open', bot_paused: false, archived_at: null }
export const WORKSPACE = { phone_number_id: 'pn-1', meta_token: 'encrypted-token' }

// Configuração de Supabase do "caminho feliz": paciente e conversa já
// existem, workspace tem WhatsApp configurado, nada agendado.
export function defaultSupabaseConfig(): SupabaseMockConfig {
  return {
    patients: { select: { data: { ...PATIENT } }, insert: { data: { ...PATIENT } }, update: { data: null } },
    conversations: { select: { data: { ...CONVERSATION } }, insert: { data: { ...CONVERSATION } }, update: { data: null } },
    // Histórico: só a mensagem que o paciente acabou de mandar (primeira troca).
    messages: { insert: { data: null }, select: { data: [{ role: 'user', content: PARAMS.message }] } },
    workspaces: { select: { data: { ...WORKSPACE } } },
    appointments: { select: { data: [] }, insert: { data: null }, update: { data: null } },
    handoff_hours: { select: { data: [], count: 0 } },
    handoff_logs: { insert: { data: null } },
  }
}

/** Reinicia todo o estado do harness. Chamar em beforeEach de cada suite. */
export function resetAgentHarness(config: SupabaseMockConfig = defaultSupabaseConfig()) {
  state.supabase = createSupabaseMock(config)
  state.botConfig = { ...DEFAULT_BOT_CONFIG }
  state.claudeResponses = []
  state.freeSlots = { '*': ['08:00', '08:30', '09:00'] }
  state.slotAvailable = true
  state.googleConnected = false
  state.googleEmail = null
  state.createEventError = null
  sendWhatsAppMessage.mockClear()
  createEvent.mockClear()
  cancelEvent.mockClear()
  isSlotAvailable.mockClear()
  getFreeSlotsForBot.mockClear()
  claudeCreate.mockClear()
  return state.supabase
}

/** Substitui o mock do Supabase por um com outra configuração. */
export function applySupabaseConfig(config: SupabaseMockConfig) {
  state.supabase = createSupabaseMock(config)
  return state.supabase
}

/** Mescla configuração por tabela em cima do caminho feliz. */
export function mergeSupabaseConfig(overrides: SupabaseMockConfig) {
  const base = defaultSupabaseConfig()
  for (const [table, ops] of Object.entries(overrides)) {
    base[table] = { ...(base[table] ?? {}), ...ops }
  }
  return applySupabaseConfig(base)
}

export const PARAMS = {
  workspaceId: 'w1',
  accountId: 'acc1',
  workspaceName: 'Clínica Teste',
  patientPhone: '5511988887777',
  message: 'Oi, quero marcar uma consulta',
  whatsappMessageId: 'wamid.1',
}

/** Última mensagem que o bot enviou de fato ao paciente pelo WhatsApp. */
export function lastSentMessage(): string | undefined {
  const calls = sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>
  return calls.at(-1)?.[0]?.message
}

/** Todas as mensagens enviadas ao paciente, na ordem. */
export function sentMessages(): string[] {
  const calls = sendWhatsAppMessage.mock.calls as unknown as Array<[{ message: string }]>
  return calls.map((c) => c[0].message)
}
