import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** Máximo de conversas que a busca no banco devolve. */
export const SEARCH_LIMIT = 50

/**
 * Dígitos a procurar no telefone salvo. Com mais de 8 dígitos usa só os 8
 * finais: eles não mudam com ou sem o 55, o DDD ou o nono dígito — a Meta às
 * vezes entrega o celular sem o 9 ("557192618890"), e a pessoa digita com ele.
 * Menos de 4 dígitos não busca por telefone.
 */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.length > 8 ? digits.slice(-8) : digits
}

/** Texto para buscar por nome: precisa ter ao menos uma letra. */
export function nameSearchText(query: string): string | null {
  const text = query.trim().toLowerCase()
  return /\p{L}/u.test(text) ? text : null
}

export function matchesConversationQuery(
  c: { patient_name: string | null; patient_whatsapp_name: string | null; patient_phone: string | null },
  query: string
): boolean {
  const name = nameSearchText(query)
  if (name && ((c.patient_name ?? '').toLowerCase().includes(name) || (c.patient_whatsapp_name ?? '').toLowerCase().includes(name))) {
    return true
  }
  const digits = phoneSearchDigits(query)
  return !!digits && (c.patient_phone ?? '').replace(/\D/g, '').includes(digits)
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

/**
 * Ids das conversas da account que batem com a busca, mais recentes primeiro.
 * Procura no banco inteiro — a tela só carrega as conversas mais recentes.
 */
export async function searchConversationIds(
  supabase: SupabaseClient<Database>,
  accountId: string,
  query: string
): Promise<string[]> {
  const digits = phoneSearchDigits(query)
  const name = nameSearchText(query)
  if (!digits && !name) return []

  const ids = new Set<string>()

  if (digits) {
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .like('patient_phone', likePattern(digits))
      .order('started_at', { ascending: false })
      .limit(SEARCH_LIMIT)
    for (const r of data ?? []) ids.add(r.id)
  }

  if (name) {
    const pattern = likePattern(name)
    const { data: byName } = await supabase
      .from('patients')
      .select('id')
      .eq('account_id', accountId)
      .ilike('full_name', pattern)
      .limit(SEARCH_LIMIT)
    // whatsapp_name depende de migration: erro = só não busca por ele.
    const { data: byWhatsApp } = await supabase
      .from('patients')
      .select('id')
      .eq('account_id', accountId)
      .ilike('whatsapp_name', pattern)
      .limit(SEARCH_LIMIT)
    const patientIds = [...new Set([...(byName ?? []), ...(byWhatsApp ?? [])].map((p) => p.id))]
    if (patientIds.length) {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .in('patient_id', patientIds)
        .order('started_at', { ascending: false })
        .limit(SEARCH_LIMIT)
      for (const r of data ?? []) ids.add(r.id)
    }
  }

  return [...ids].slice(0, SEARCH_LIMIT)
}
