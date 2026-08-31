import { createAdminClient } from '@/lib/supabase/server'

// Configuração da Maria — uma por account, vale para todas as unidades.
// Campos que variam por unidade (endereço, horário, estacionamento, contato,
// preço, número de handoff) NÃO estão aqui: ficam em workspaces e são
// carregados à parte (ver getAccountUnits).
export interface BotConfig {
  specialty: string | null
  procedures: string[]
  insurancePlans: string[]
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
}

// Contexto de uma unidade para a Maria — o que ela informa ao paciente e usa
// para agendar. Slots livres e catálogo de procedimentos são carregados à
// parte no agente (dependem de data).
export interface UnitContext {
  id: string
  name: string
  address: string | null
  businessHours: string | null
  directionsParking: string | null
  contactInfo: string | null
  consultationPriceFrom: number | null
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
    procedures: data.procedures ?? [],
    insurancePlans: data.insurance_plans ?? [],
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
  }

  configCache.set(accountId, { data: config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

// Unidades ativas da account, com os campos que a Maria usa por unidade.
export async function getAccountUnits(accountId: string): Promise<UnitContext[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('workspaces')
    .select(
      'id, name, address, business_hours, directions_parking, contact_info, consultation_price_from, handoff_number, display_order'
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('display_order')

  return (data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    address: w.address,
    businessHours: w.business_hours,
    directionsParking: w.directions_parking,
    contactInfo: w.contact_info,
    consultationPriceFrom: w.consultation_price_from != null ? Number(w.consultation_price_from) : null,
    handoffNumber: w.handoff_number,
  }))
}

// Invalidar cache quando a account salvar novas configurações
export function invalidateBotConfigCache(accountId: string) {
  configCache.delete(accountId)
}
