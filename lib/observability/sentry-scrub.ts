// MedScale lida com dado clínico e pessoal de paciente (LGPD). Telefones
// aparecem em mensagens de erro, payloads de webhook e breadcrumbs de
// fetch/console — este scrub roda no beforeSend/beforeBreadcrumb dos três
// runtimes do Sentry (client, server, edge) antes de qualquer evento sair
// da aplicação.

// Padrões de telefone brasileiro: com DDI (+55), com DDD mascarado, e a
// sequência crua de dígitos que a Meta manda (ex: "5511999999999").
const PHONE_PATTERNS: RegExp[] = [
  /\+?55[\s.-]?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g,
  /\(?\d{2}\)?[\s.-]?9\d{4}[\s.-]?\d{4}/g,
  /\b\d{10,13}\b/g,
]

const REDACTED = '[redacted-phone]'

function redactPhones(value: string): string {
  return PHONE_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), value)
}

// Percorre o evento inteiro (mensagem, exception.values[].value, breadcrumbs,
// request, extra, contexts…) redigindo qualquer string. Profundidade limitada
// pra não travar em estruturas circulares/enormes.
function deepRedact(input: unknown, depth: number): unknown {
  if (depth > 6) return input
  if (typeof input === 'string') return redactPhones(input)
  if (Array.isArray(input)) return input.map((v) => deepRedact(v, depth + 1))
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deepRedact(v, depth + 1)
    }
    return out
  }
  return input
}

// beforeSend só roda em eventos de erro (não em transações), então o custo do
// clone profundo é irrelevante.
export function scrubSentryEvent<T>(event: T): T {
  return deepRedact(event, 0) as T
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T {
  return deepRedact(breadcrumb, 0) as T
}
