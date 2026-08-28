import { createAdminClient } from '@/lib/supabase/server'

// Checks compartilhados pelas duas rotas de health (`/api/health` crítico e
// `/api/health/details` informativo) — mantê-los aqui evita que as duas
// versões divirjam.

export type Check = { ok: boolean; error?: string }

// Banco (Supabase) — query leve só pra confirmar que o Postgres responde.
// O supabase-js não lança em erro de query: precisa checar `error` na mão.
export async function checkDatabase(): Promise<Check> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('accounts').select('id').limit(1)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// LLM (Anthropic) — só confirma que a chave existe. Uma chamada real seria
// lenta e cara pra um check que roda a cada poucos minutos.
export function checkLlm(): Check {
  return { ok: Boolean(process.env.ANTHROPIC_API_KEY) }
}

// Maria — conta workspaces com o bot ativo (`is_active = true` no bot_config).
// Zero não é necessariamente queda (staging, onboarding incompleto), por isso
// esse check é só informativo e não entra na rota crítica.
export async function checkMaria(): Promise<Check & { active_workspaces: number }> {
  try {
    const supabase = createAdminClient()
    const { count, error } = await supabase
      .from('bot_config')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    if (error) throw new Error(error.message)
    return { ok: (count ?? 0) > 0, active_workspaces: count ?? 0 }
  } catch (err) {
    return {
      ok: false,
      active_workspaces: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// Agente financeiro — sem FINANCE_PHONE_NUMBER_ID o roteamento por
// phone_number_id no webhook nunca bate e o agente nunca é acionado. Ausência
// pode ser intencional se o módulo não estiver ativo, então também é só
// informativo.
export function checkFinanceAgent(): Check {
  return { ok: Boolean(process.env.FINANCE_PHONE_NUMBER_ID) }
}
