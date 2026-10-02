import { createAdminClient } from '@/lib/supabase/server'
import type { NumberSource } from '@/types/database'

// Configuração da Clara — uma por account, vale para todas as unidades.
// Campos que variam por unidade (endereço, horário, estacionamento, contato,
// número de handoff) NÃO estão aqui: ficam em workspaces/availability_rules e são carregados à
// parte (ver getAccountUnits). Procedimentos vêm do catálogo (procedure_catalog)
// e convênios de health_insurers, carregados no agente.
export interface BotConfig {
  specialty: string | null
  acceptsPrivate: boolean
  paymentMethods: string[]
  pricingInfo: string | null
  examPreparation: string | null
  policies: string | null
  toneOfVoice: string | null
  handoffInstructions: string | null
  forbiddenActions: string | null
  faq: { question: string; answer: string }[]
  handoffMessage: string
  welcomeMessage: string
  outOfHoursMessage: string
  isActive: boolean
  // Conexão WhatsApp da account (número único).
  phoneNumberId: string | null
  metaToken: string | null // criptografado (lib/crypto.ts)
  // Quem paga a Meta pela janela de 24h: 'own' = a clínica traz o App dela e
  // paga direto; 'medscale' = número provisionado por nós, e a conversa entra
  // no nosso custo variável (ver lib/costs/record.ts).
  numberSource: NumberSource
}

// Contexto de uma unidade para a Clara — o que ela informa ao paciente e usa
// para agendar. Slots livres e catálogo de procedimentos são carregados à
// parte no agente (dependem de data).
export interface UnitContext {
  id: string
  name: string
  address: string | null
  businessHours: string | null // resumo do expediente ativo em availability_rules
  directionsParking: string | null
  contactInfo: string | null
  handoffNumber: string | null
}

// Cache simples em memória (por processo) — evita query ao banco em cada mensagem.
// Em ambiente serverless cada instância tem seu próprio cache, então o TTL curto
// importa mais do que a invalidação explícita (que só afeta a instância que
// recebeu o PATCH); mesmo assim invalidamos para o caso comum de instância única.
const configCache = new Map<string, { data: BotConfig; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

export async function getBotConfig(accountId: string): Promise<BotConfig | null> {
  const cached = configCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('bot_config').select('*').eq('account_id', accountId).maybeSingle()

  if (error || !data) return null

  const config: BotConfig = {
    specialty: data.specialty,
    acceptsPrivate: data.accepts_private,
    paymentMethods: data.payment_methods ?? [],
    pricingInfo: data.pricing_info,
    examPreparation: data.exam_preparation,
    policies: data.policies,
    toneOfVoice: data.tone_of_voice,
    handoffInstructions: data.handoff_instructions,
    forbiddenActions: data.forbidden_actions,
    faq: data.faq ?? [],
    handoffMessage: data.handoff_message,
    welcomeMessage: data.welcome_message,
    outOfHoursMessage: data.out_of_hours_message,
    isActive: data.is_active,
    phoneNumberId: data.phone_number_id,
    metaToken: data.meta_token,
    numberSource: data.number_source,
  }

  configCache.set(accountId, { data: config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

// Unidades ativas da account, com os campos que a Clara usa por unidade.
export async function getAccountUnits(accountId: string): Promise<UnitContext[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('workspaces')
    .select(
      'id, name, address, directions_parking, contact_info, handoff_number, display_order'
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('display_order')

  if (!data?.length) return []

  const { data: rules } = await supabase
    .from('availability_rules')
    .select('workspace_id, day_of_week, start_time, end_time')
    .in('workspace_id', data.map((w) => w.id))
    .eq('is_active', true)
    .order('day_of_week')
    .order('start_time')

  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  const schedules = new Map<string, Map<number, Set<string>>>()
  for (const rule of rules ?? []) {
    const schedule = schedules.get(rule.workspace_id) ?? new Map<number, Set<string>>()
    const intervals = schedule.get(rule.day_of_week) ?? new Set<string>()
    intervals.add(`${rule.start_time.slice(0, 5)}–${rule.end_time.slice(0, 5)}`)
    schedule.set(rule.day_of_week, intervals)
    schedules.set(rule.workspace_id, schedule)
  }

  return (data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    address: w.address,
    businessHours: schedules.has(w.id)
      ? [...schedules.get(w.id)!]
          .sort(([a], [b]) => a - b)
          .map(([day, intervals]) => `${days[day]}: ${[...intervals].sort().join(', ')}`)
          .join('; ') + ' (America/Sao_Paulo)'
      : null,
    directionsParking: w.directions_parking,
    contactInfo: w.contact_info,
    handoffNumber: w.handoff_number,
  }))
}

// Invalidar cache quando a account salvar novas configurações
export function invalidateBotConfigCache(accountId: string) {
  configCache.delete(accountId)
}
