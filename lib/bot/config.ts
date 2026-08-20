import { createAdminClient } from '@/lib/supabase/server'

export interface BotConfig {
  botName: string
  specialty: string | null
  procedures: string[]
  insurancePlans: string[]
  acceptsPrivate: boolean
  consultationPriceFrom: number | null
  businessHours: string | null
  handoffNumber: string | null
  handoffMessage: string
  welcomeMessage: string
  outOfHoursMessage: string
  isActive: boolean
}

// Cache simples em memória (por processo) — evita query ao banco em cada mensagem.
// Em ambiente serverless cada instância tem seu próprio cache, então o TTL curto
// importa mais do que a invalidação explícita (que só afeta a instância que
// recebeu o PATCH); mesmo assim invalidamos para o caso comum de instância única.
const configCache = new Map<string, { data: BotConfig; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

export async function getBotConfig(workspaceId: string): Promise<BotConfig | null> {
  const cached = configCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('bot_config').select('*').eq('workspace_id', workspaceId).single()

  if (error || !data) return null

  const config: BotConfig = {
    botName: data.bot_name,
    specialty: data.specialty,
    procedures: data.procedures ?? [],
    insurancePlans: data.insurance_plans ?? [],
    acceptsPrivate: data.accepts_private,
    consultationPriceFrom: data.consultation_price_from ? Number(data.consultation_price_from) : null,
    businessHours: data.business_hours,
    handoffNumber: data.handoff_number,
    handoffMessage: data.handoff_message,
    welcomeMessage: data.welcome_message,
    outOfHoursMessage: data.out_of_hours_message,
    isActive: data.is_active,
  }

  configCache.set(workspaceId, { data: config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

// Invalidar cache quando a workspace salvar novas configurações
export function invalidateBotConfigCache(workspaceId: string) {
  configCache.delete(workspaceId)
}
