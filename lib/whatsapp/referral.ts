import { createAdminClient } from '@/lib/supabase/server'

/** O que a Meta manda junto da PRIMEIRA mensagem de quem veio de um anúncio
 *  Click-to-WhatsApp. Não vem nas mensagens seguintes da mesma conversa, e não
 *  há como recuperar depois — a Graph API não expõe o histórico de cliques. */
export interface ParsedReferral {
  sourceId: string
  sourceType: string
  sourceUrl: string | null
  headline: string | null
  body: string | null
  ctwaClid: string | null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function parseReferral(message: unknown): ParsedReferral | null {
  if (typeof message !== 'object' || message === null) return null

  const referral = (message as { referral?: unknown }).referral
  if (typeof referral !== 'object' || referral === null) return null

  const fields = referral as Record<string, unknown>
  const sourceId = str(fields.source_id)
  // Sem o ID do anúncio a linha não serve para nada: é justamente ela que
  // fecha a ponte com a campanha, via meta_ad_map.
  if (!sourceId) return null

  return {
    sourceId,
    sourceType: str(fields.source_type) ?? 'ad',
    sourceUrl: str(fields.source_url),
    headline: str(fields.headline),
    body: str(fields.body),
    ctwaClid: str(fields.ctwa_clid),
  }
}

export async function recordAttribution(
  args: { accountId: string; patientPhone: string; referral: ParsedReferral },
  client = createAdminClient()
): Promise<void> {
  const { error } = await client.from('lead_attributions').upsert(
    {
      account_id: args.accountId,
      patient_phone: args.patientPhone,
      source_id: args.referral.sourceId,
      source_type: args.referral.sourceType,
      source_url: args.referral.sourceUrl,
      headline: args.referral.headline,
      body: args.referral.body,
      ctwa_clid: args.referral.ctwaClid,
    },
    { onConflict: 'account_id,ctwa_clid', ignoreDuplicates: true }
  )
  // Não relançamos: perder uma atribuição é ruim, perder a resposta ao paciente
  // é pior. O webhook precisa devolver 200 em menos de 20s de qualquer jeito.
  if (error) console.error('[whatsapp] recordAttribution falhou', error)
}
