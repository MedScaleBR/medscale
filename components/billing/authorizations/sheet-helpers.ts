import type { AuthorizationItem } from '@/lib/billing/authorizations/types'
import type { ResponseInput } from '@/lib/billing/authorizations/validation'
import { parseCents } from '../money'

// Funções puras do sheet de autorização (testadas em tests/billing/authorizations-ui.test.ts).

// Texto vazio vira null; listas perdem os vazios; objeto todo vazio do
// executante vira null (o servidor exige código + CNES ou nada).
function normalize(key: string, v: unknown): unknown {
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  if (Array.isArray(v)) return v.map((x) => normalize('', x)).filter((x) => x !== null)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = normalize(k, x)
    if (key === 'executor' && Object.values(out).every((x) => x === null)) return null
    return out
  }
  return v
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(rb, k) && deepEqual(ra[k], rb[k]))
}

// Só as chaves de `request` que mudaram (PATCH parcial); null se nada mudou.
export function buildRequestPatch(original: object, current: object): Record<string, unknown> | null {
  const before = new Map(Object.entries(original))
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(current)) {
    const next = normalize(key, value)
    if (!deepEqual(normalize(key, before.get(key)), next)) patch[key] = next
  }
  return Object.keys(patch).length > 0 ? patch : null
}

export type ResponseItemDraft = { quantity: string; value: string }

// Toda linha leva quantity_authorized e authorized_value_cents (o RPC
// sobrescreve com null o que faltar); valor autorizado só em OPME.
export function buildResponseItems(
  items: AuthorizationItem[],
  drafts: Record<string, ResponseItemDraft>,
): { ok: true; value: ResponseInput['items'] } | { ok: false; error: string } {
  const out: ResponseInput['items'] = []
  for (const [i, item] of items.entries()) {
    const d = drafts[item.id] ?? { quantity: '', value: '' }
    const q = d.quantity.trim()
    let quantity: number | null = null
    if (q !== '') {
      if (!/^\d+$/.test(q) || Number(q) > 999) return { ok: false, error: `Item ${i + 1}: quantidade autorizada entre 0 e 999.` }
      quantity = Number(q)
      if (quantity > item.quantity_requested) {
        return { ok: false, error: `Item ${i + 1}: quantidade autorizada maior que a solicitada.` }
      }
    }
    let cents: number | null = null
    if (item.kind === 'opme' && d.value.trim() !== '') {
      cents = parseCents(d.value)
      if (cents === null) return { ok: false, error: `Item ${i + 1}: valor autorizado inválido.` }
    }
    out.push({ id: item.id, quantity_authorized: quantity, authorized_value_cents: cents })
  }
  return { ok: true, value: out }
}

export function fileNameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null
  return match ? match[1] : null
}

// telefoneProfissional é st_texto11: só dígitos (o servidor também limpa).
export function phoneDigits(v: string): string | null {
  return v.replace(/\D/g, '') || null
}

// A descrição do catálogo pode passar do limite do XSD (150): cortar ao pré-preencher.
export const catalogItemDescription = (description: string): string => description.slice(0, 150)

// Dica sobre o anexo OPME. No pai, `activeOpmeCount` é o número de anexos
// ativos. No próprio OPME a contagem não está disponível (os filhos dele são
// sempre zero), então a frase não pode afirmar que ele vai embutido: isso só
// acontece quando ele é o único ativo (selectEmbeddedOpme).
export function opmeEmbedHint(activeOpmeCount: number, isOpme: boolean): string | null {
  if (isOpme) {
    return 'Este anexo só vai embutido no XML da solicitação de origem se for o único OPME ativo. Com mais de um, baixe o XML deste anexo.'
  }
  if (activeOpmeCount === 1) return 'Este anexo vai embutido no XML desta solicitação.'
  return null
}
