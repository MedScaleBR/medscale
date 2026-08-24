import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import type { HandoffTriggerReason } from '@/types/database'

const TZ = 'America/Sao_Paulo'

interface HandoffParams {
  workspaceId: string
  conversationId: string
  patientPhone: string
  handoffNumber: string
  handoffMessage: string
  phoneNumberId: string
  metaToken: string // já descriptografado pelo chamador
  triggerReason: HandoffTriggerReason
}

export async function executeHandoff(params: HandoffParams) {
  const { workspaceId, conversationId, patientPhone, handoffNumber, handoffMessage, phoneNumberId, metaToken, triggerReason } =
    params

  const supabase = createAdminClient()

  // 1. Enviar mensagem de transição para o paciente
  await sendWhatsAppMessage({ to: patientPhone, message: handoffMessage, phoneNumberId, token: metaToken })

  // 2. Enviar o número de contato humano
  await sendWhatsAppMessage({ to: patientPhone, message: `Contato: ${handoffNumber}`, phoneNumberId, token: metaToken })

  // 3. Marcar conversa como handoff no banco e pausar o bot — ele só volta a
  // responder quando a equipe reativar pelo painel.
  await supabase
    .from('conversations')
    .update({ status: 'handoff', bot_paused: true, resolved_at: new Date().toISOString() })
    .eq('id', conversationId)

  // 4. Registrar log de handoff
  await supabase.from('handoff_logs').insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    patient_phone: patientPhone,
    trigger_reason: triggerReason,
    handoff_to: handoffNumber,
  })
}

// Registra que um handoff foi pedido fora do horário de atendimento humano —
// o bot NÃO transfere de verdade (ninguém para atender), apenas fica esse
// rastro para a equipe ver depois em handoff_logs. A conversa continua 'open'
// e o bot segue ajudando o paciente sozinho.
export async function logHandoffUnavailable(params: {
  workspaceId: string
  conversationId: string
  patientPhone: string
  handoffNumber: string
}) {
  const supabase = createAdminClient()
  await supabase.from('handoff_logs').insert({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    patient_phone: params.patientPhone,
    trigger_reason: 'out_of_hours',
    handoff_to: params.handoffNumber,
  })
}

// Detecta se a resposta do LLM indica necessidade de handoff
export function detectHandoffIntent(
  assistantMessage: string,
  userMessage: string
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

  return { needed: false, reason: null }
}

// O bot em si conversa e agenda 24/7 — isto decide só se o handoff para um
// humano pode acontecer de verdade agora. Sem nenhuma regra cadastrada em
// handoff_hours, o handoff fica disponível 24/7 por padrão (mesma convenção
// de availability_rules: recurso opt-in, não quebra quem ainda não configurou).
export async function isHandoffAvailableNow(workspaceId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const now = new TZDate(new Date(), TZ)
  const dayOfWeek = now.getDay()

  const { data: rules } = await supabase
    .from('handoff_hours')
    .select('start_time, end_time')
    .eq('workspace_id', workspaceId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  if (!rules) return true

  if (rules.length === 0) {
    const { count } = await supabase
      .from('handoff_hours')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    if (!count) return true // nenhuma regra cadastrada ainda — handoff sempre disponível
    return false // há regras para outros dias, mas não para hoje
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return rules.some((r) => {
    const [startH, startM] = r.start_time.split(':').map(Number)
    const [endH, endM] = r.end_time.split(':').map(Number)
    return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
  })
}
