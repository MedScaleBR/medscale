import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import type { HandoffTriggerReason } from '@/types/database'

// Regras de handoff que só LEEM (detecção de intenção e horário de atendimento
// humano). Ficam fora de handoff.ts para o simulador da Clara usar sem importar
// as funções que enviam WhatsApp e gravam no banco.

const TZ = 'America/Sao_Paulo'

// Detecta se a resposta do LLM indica necessidade de handoff
export function detectHandoffIntent(
  assistantMessage: string,
  userMessage: string,
  injectionSignalCount = 0
): { needed: boolean; reason: HandoffTriggerReason | null } {
  // Sinalização explícita do LLM (via instrução no prompt)
  if (assistantMessage.includes('[HANDOFF]')) {
    return { needed: true, reason: 'bot_uncertain' }
  }

  // Pedido explícito do paciente
  const userLower = userMessage.toLowerCase()
  const humanKeywords = [
    'falar com',
    'atendente',
    'humano',
    'pessoa',
    'secretaria',
    'recepção',
    'ligar',
    'ligar pra',
    'telefone',
    'não quero robô',
    'não é robô',
    'quero falar',
    'me chama',
  ]
  if (humanKeywords.some((k) => userLower.includes(k))) {
    return { needed: true, reason: 'user_request' }
  }

  // Dois ou mais sinais de injection na janela recente. Um sinal isolado é
  // ruído esperado (a heurística tem falso positivo por construção); um padrão
  // repetido vira gente. O paciente nunca sabe que isto existe — o handoff usa
  // a mesma mensagem genérica de qualquer outro.
  if (injectionSignalCount >= 2) {
    return { needed: true, reason: 'injection_suspected' }
  }

  return { needed: false, reason: null }
}

// O bot em si conversa e agenda 24/7 — isto decide só se o handoff para um
// humano pode acontecer de verdade agora. Sem nenhuma regra cadastrada em
// handoff_hours, usa o Global da conta. Sem ambos, fica disponível 24/7.
//
// `at` existe para o simulador da Clara (/admin) testar outro horário; a
// produção sempre usa o relógio real.
export async function isHandoffAvailableNow(
  workspaceId: string,
  accountId?: string,
  at: Date = new Date()
): Promise<boolean> {
  const supabase = createAdminClient()
  const now = new TZDate(at, TZ)
  const dayOfWeek = now.getDay()

  const { data: localRules } = await supabase
    .from('handoff_hours')
    .select('start_time, end_time')
    .eq('workspace_id', workspaceId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  if (!localRules) return true

  let rules = localRules
  if (rules.length === 0) {
    const { count } = await supabase
      .from('handoff_hours')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    if (count) return false // A unidade tem cadastro próprio, mas está fechada hoje.

    // Global pertence à conta e só atende unidades sem cadastro próprio.
    let resolvedAccountId = accountId
    if (!resolvedAccountId) {
      const { data: workspace } = await supabase.from('workspaces').select('account_id').eq('id', workspaceId).single()
      resolvedAccountId = workspace?.account_id
    }
    if (!resolvedAccountId) return true
    const { data: globalRules } = await supabase
      .from('account_handoff_hours')
      .select('start_time, end_time')
      .eq('account_id', resolvedAccountId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
    if (!globalRules) return true
    rules = globalRules
    if (rules.length === 0) {
      const { count: globalCount } = await supabase
        .from('account_handoff_hours')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', resolvedAccountId)
      return !globalCount
    }
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return rules.some((r) => {
    const [startH, startM] = r.start_time.split(':').map(Number)
    const [endH, endM] = r.end_time.split(':').map(Number)
    return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
  })
}
