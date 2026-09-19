import type { AttributedLead } from './attribution'

// ROI por campanha. Puro — a página busca e agrega, isto divide.
//
// LIMITE HONESTO: consulta por convênio não gera `revenue_entry` (ver
// `appointments.health_plan` no schema). Numa clínica que atende convênio o
// ROI sai subestimado, e a tela precisa dizer isso em nota de rodapé.

export interface RoiResult {
  /** Receita paga atribuída à campanha. */
  revenue: number
  /**
   * Quantas vezes o investimento voltou. Nulo quando não há investimento:
   * dividir por zero daria Infinity e a tela imprimiria "∞x".
   */
  roi: number | null
}

interface SpendLike {
  externalId: string | null
  spend: number
}

export function roiByCampaign(
  leads: AttributedLead[],
  totals: SpendLike[]
): Map<string, RoiResult> {
  const revenueByCampaign = new Map<string, number>()
  for (const lead of leads) {
    // Anúncio ainda sem mapa: o lead conta no total, mas não tem campanha a
    // que creditar a receita.
    if (!lead.campaignId) continue
    revenueByCampaign.set(
      lead.campaignId,
      (revenueByCampaign.get(lead.campaignId) ?? 0) + lead.paidRevenue
    )
  }

  const result = new Map<string, RoiResult>()
  for (const total of totals) {
    // Campanha manual não tem par na Meta; agrupar todas sob a chave nula
    // somaria campanhas diferentes numa só.
    if (!total.externalId) continue
    const revenue = revenueByCampaign.get(total.externalId) ?? 0
    result.set(total.externalId, {
      revenue,
      roi: total.spend > 0 ? revenue / total.spend : null,
    })
  }

  return result
}
