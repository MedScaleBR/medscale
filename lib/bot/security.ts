import type { BotConfig } from './config'

// Heurísticas locais contra prompt injection. Tudo aqui é regex/string puro:
// nenhuma chamada a LLM, nenhum I/O — o custo por mensagem não pode subir.
//
// Premissa de projeto: TODA detecção aqui é heurística e vai ter falso
// positivo. Nada nestas funções bloqueia o atendimento por conta própria; o
// consumidor decide, e o fallback em qualquer ambiguidade é sempre "deixa o
// bot seguir ou escala pra humano", nunca "recusa responder ao paciente".

export type InjectionPattern = 'prompt_extraction' | 'role_override' | 'authority_claim' | 'raw_marker_injection'

export interface InjectionSignal {
  pattern: InjectionPattern
  /** Trecho que casou, truncado. Só para auditoria interna — nunca vai a log externo. */
  matched_text: string
}

// Nomes dos marcadores de controle e dos delimitadores de sistema. Colados
// aqui de propósito em vez de importados de parse-markers: lá as regexes
// exigem o payload completo (uuid, data ISO); aqui basta o paciente ESCREVER
// o nome do marcador para virar sinal.
const CONTROL_TOKENS =
  /(AGENDAMENTO_CONFIRMADO|CANCELAMENTO_CONFIRMADO|NOME_PACIENTE|PROCEDIMENTO_ID|UNIDADE_ID|LISTA_ESPERA)\s*:|\[HANDOFF\]|<\/?\s*(mensagem_paciente|transcricao_consulta)\s*>/i

// "ignore/esqueça ... as instruções/regras" — o objeto é obrigatório. É o que
// separa "ignore as instruções anteriores" (injection) de "posso ignorar o
// jejum?" (pergunta clínica legítima). Note que \b impede que "ignora" case
// dentro de "ignorar".
const ROLE_OVERRIDE =
  /\b(?:ignore|ignora|esque[çc]a|esquece|desconsidere|desconsidera|apague|apaga)\b\s+(?:as?\s+|todas?\s+as?\s+|o\s+|todo\s+o\s+|seu\s+|suas\s+)?(?:instru[çc][õo]es|(?:regras|orienta[çc][õo]es)(?!\s+de\s+(?:reembolso|cancelamento|agendamento|remarca[çc][ãa]o|conv[êe]nio|atendimento|pagamento|jejum|preparo|exame|consulta))|diretrizes|prompt|contexto|restri[çc][õo]es)\b|\bvoc[êe]\s+agora\s+[ée]\s+(?:um|uma|o|a)\b|\baja\s+como\b|\bfinja\s+(?:que\s+)?(?:voc[êe]|ser)\b|\bfa[çc]a\s+de\s+conta\s+que\s+voc[êe]\b|\bsem\s+(?:nenhuma\s+)?restri[çc][õo]es?\b|\bnovo\s+(?:papel|modo|sistema)\b/i

// Pedido de revelar o prompt. Exige verbo + alvo: "regras de cancelamento"
// (pergunta legítima da clínica) não casa, "suas instruções" casa.
const PROMPT_EXTRACTION =
  /\b(?:repita|repete|reproduza|mostre|mostra|exiba|imprima|revele|revela|liste|lista|transcreva|qual\s+[ée]|quais\s+s[ãa]o)[^.?!\n]{0,40}\b(?:system\s*prompt|prompt\s+do\s+sistema|prompt\s+inicial|(?:suas|tuas)\s+(?:instru[çc][õo]es|regras|diretrizes)|instru[çc][õo]es\s+(?:anteriores|iniciais|do\s+sistema|acima)|texto\s+(?:anterior|acima)|tudo\s+(?:que|o\s+que)\s+(?:foi|est[áa])\s+(?:dito|escrito|acima))/i

// Alegação de autoridade. O sistema NUNCA fala com o modelo pelo canal do
// paciente, então qualquer credencial que chegue por ali é só texto.
const AUTHORITY_CLAIM =
  /\b(?:sou|somos|aqui\s+[ée])\b[^.?!\n]{0,30}\b(?:da\s+equipe|do\s+suporte|do\s+time|desenvolvedor|programador|administrador|admin|t[ée]cnico\s+da|respons[áa]vel\s+pelo\s+(?:bot|sistema))\b|\bmodo\s+(?:debug|desenvolvedor|dev|manuten[çc][ãa]o|teste|admin)\b|\b(?:isso|isto)\s+[ée]\s+(?:s[óo]\s+|apenas\s+)?um\s+teste\b|\bestou\s+autorizad[oa]\s+(?:a|para)\b/i

// A ordem importa: do mais determinístico (marcador literal) ao mais
// ambíguo. A primeira que casar ganha — um sinal é um sinal, o consumidor só
// conta quantos houve.
const PATTERNS: Array<[InjectionPattern, RegExp]> = [
  ['raw_marker_injection', CONTROL_TOKENS],
  ['prompt_extraction', PROMPT_EXTRACTION],
  ['role_override', ROLE_OVERRIDE],
  ['authority_claim', AUTHORITY_CLAIM],
]

const MAX_MATCH_LEN = 80

export function detectInjectionAttempt(message: string): InjectionSignal | null {
  if (!message) return null
  for (const [pattern, regex] of PATTERNS) {
    const match = message.match(regex)
    if (match) {
      return { pattern, matched_text: match[0].slice(0, MAX_MATCH_LEN) }
    }
  }
  return null
}

const MAX_NAME_LEN = 60

// Verbos no imperativo que abrem uma ordem. Um nome próprio nunca começa
// assim; uma injection que escapou para dentro do NOME_PACIENTE, sim.
const LEADING_IMPERATIVE =
  /^(?:ignore|ignora|esque[çc]a|esquece|desconsidere|diga|diz|fale|fala|responda|responde|mostre|mostra|repita|repete|escreva|escreve|envie|envia|mande|manda|crie|cria|apague|apaga|delete|confirme|confirma|cancele|cancela|agende|agenda|aja|finja|atue|execute|liste|lista)\b/i

export function sanitizePatientName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return null
  if (name.length > MAX_NAME_LEN) return null
  if (/[\r\n]/.test(name)) return null
  if (/[<>]/.test(name)) return null
  if (CONTROL_TOKENS.test(name)) return null
  if (LEADING_IMPERATIVE.test(name)) return null
  // Whitelist: only letters (Unicode-aware), apostrophes, periods, hyphens, spaces
  if (!/^[\p{L}][\p{L}''.\-\s]*$/u.test(name)) return null
  // Reject if more than 6 words (potential injection continuation)
  if (name.split(/\s+/).length > 6) return null
  // Reject if name itself triggers injection detection
  if (detectInjectionAttempt(name)) return null
  return name
}

// Percentual "solto" perto de uma palavra de desconto. A janela de 40 chars
// dos dois lados é o que separa "50% de desconto" de "90% de recuperação".
const PERCENT = /(\d{1,3})\s*%/g
const DISCOUNT_CONTEXT = /desconto|descontos|off\b|abatimento|promo[çc][ãa]o|promocional|cortesia/i
const CONTEXT_WINDOW = 40

function configuredText(config: BotConfig): string {
  return [
    config.pricingInfo ?? '',
    config.policies ?? '',
    config.forbiddenActions ?? '',
    ...config.faq.flatMap((item) => [item.question, item.answer]),
  ].join('\n')
}

// Fail-safe financeiro: a clínica não tem campo de desconto em lugar nenhum
// (nem em bot_config, nem em workspaces, nem em procedure_catalog). Um
// percentual só é "configurado" se o número aparecer literalmente no texto
// livre que a clínica escreveu. Qualquer outro percentual de desconto na
// resposta do Claude é invenção — e decisão financeira não se tira de texto
// livre de LLM.
export function containsUnconfiguredDiscount(botReply: string, config: BotConfig): boolean {
  const configured = configuredText(config)
  PERCENT.lastIndex = 0
  for (const match of botReply.matchAll(PERCENT)) {
    const at = match.index ?? 0
    const window = botReply.slice(Math.max(0, at - CONTEXT_WINDOW), at + match[0].length + CONTEXT_WINDOW)
    if (!DISCOUNT_CONTEXT.test(window)) continue
    const value = match[1]
    if (!new RegExp(`(?<!\\d)${value}(?!\\d)`).test(configured)) return true
  }
  return false
}
