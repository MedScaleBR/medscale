// Tabela de preços dos provedores e conversão para reais. Este arquivo é a
// ÚNICA fonte de verdade do cálculo — quando um provedor mexe no preço, muda
// aqui e nada mais precisa ser tocado.
//
// Eventos já gravados guardam o custo em reais congelado (cost_events.cost_brl),
// então mudar um preço aqui nunca reescreve o passado: vale só dos próximos
// eventos em diante, que é o comportamento certo para custo já incorrido.

/** Cotação USD -> BRL. Sobrescrevível por env sem deploy quando o câmbio anda. */
export const USD_BRL = Number(process.env.COST_USD_BRL ?? '5.40')

interface ModelPrice {
  /** USD por 1M tokens de entrada. */
  inputPerMTok: number
  /** USD por 1M tokens de saída. */
  outputPerMTok: number
}

// Preços da API da Anthropic, em USD por 1M tokens. `claude-opus-5` é o modelo
// do interpretador financeiro (lib/finance/interpret.ts); `claude-sonnet-4-5`
// é o de todas as outras chamadas.
const CLAUDE_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
}

// Modelo fora da tabela não pode zerar o custo — um preço errado é visível no
// painel e vira bug reportado; um zero silencioso esconde gasto real. Usa o
// mais caro conhecido para errar para cima, e quem chama loga o desconhecido.
const FALLBACK_PRICE: ModelPrice = { inputPerMTok: 5, outputPerMTok: 25 }

/** true quando o modelo não está na tabela e o custo saiu do fallback. */
export function isKnownClaudeModel(model: string): boolean {
  return model in CLAUDE_PRICES
}

/** Custo em USD de uma chamada ao Claude, a partir do usage da resposta. */
export function claudeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = CLAUDE_PRICES[model] ?? FALLBACK_PRICE
  return (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok
}

// Whisper (OpenAI) cobra por minuto de áudio, arredondado ao segundo.
const WHISPER_USD_PER_MINUTE = 0.006

/** Custo em USD de uma transcrição, pela duração do áudio. */
export function whisperCostUsd(durationSeconds: number): number {
  if (!isFinite(durationSeconds) || durationSeconds <= 0) return 0
  return (durationSeconds / 60) * WHISPER_USD_PER_MINUTE
}

// Janela de 24h do WhatsApp aberta pelo paciente (conversa de serviço da Meta).
// Já é cobrada em reais, então não passa por câmbio. A Meta varia a tarifa por
// categoria e volume; este é o meio da faixa praticada hoje (R$0,30–0,80).
const WHATSAPP_CONVERSATION_BRL = Number(process.env.COST_WHATSAPP_CONVERSATION_BRL ?? '0.55')

/** Custo em BRL de uma janela de 24h que a MedScale paga à Meta. */
export function whatsappConversationCostBrl(): number {
  return WHATSAPP_CONVERSATION_BRL
}

/** Converte USD em BRL na cotação corrente, arredondado ao centavo de milésimo. */
export function toBrl(usd: number): number {
  return Math.round(usd * USD_BRL * 10_000) / 10_000
}
