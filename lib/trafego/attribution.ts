// Cadeia de atribuição: do clique no anúncio até a receita.
//
// Pura, sem I/O — toda a busca no Supabase fica na página, como em
// `lib/trafego/aggregate.ts`. As quatro listas chegam já recortadas pela
// janela da tela.

const DAY_MS = 86_400_000

/** Quanto tempo depois do clique uma consulta ainda conta como fruto do anúncio. */
export const ATTRIBUTION_WINDOW_DAYS = 90

export interface AttributedLead {
  /** Nulo quando o anúncio ainda não entrou no mapa (criado após o último sync). */
  campaignId: string | null
  campaignName: string | null
  /** Nulo junto com a campanha: sem o mapa não dá para saber o canal sem inventar. */
  channel: string | null
  patientPhone: string
  /** ISO — data do lead, âncora do funil. */
  leadAt: string
  appointments: { status: string; scheduledAt: string }[]
  /** Recebido de fato (`payment_status = 'paid'`). */
  paidRevenue: number
  /** Ainda a receber: previsto + aguardando pagamento. */
  forecastRevenue: number
}

interface AttributionRow {
  patient_phone: string
  source_id: string
  occurred_at: string
}

interface AdMapRow {
  ad_id: string
  campaign_id: string
}

interface CampaignRow {
  external_campaign_id: string | null
  campaign_name: string | null
  channel: string
}

interface AppointmentRow {
  id?: string | null
  patient_phone: string
  status: string
  scheduled_at: string
}

interface RevenueRow {
  appointment_id: string | null
  amount: number | string
  payment_status: string
}

export interface BuildLeadsInput {
  attributions: AttributionRow[]
  adMap: AdMapRow[]
  campaigns: CampaignRow[]
  appointments: AppointmentRow[]
  revenue: RevenueRow[]
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Chave de telefone tolerante a formatação: o webhook grava o número cru que a
 * Meta manda ("5511999999999") e a recepção digita com máscara. Comparar as
 * strings direto perderia a consulta em silêncio, e o lead ficaria para sempre
 * sem conversão.
 *
 * Mesma regra do agente financeiro (`lib/finance/agent.ts`): fica com DDD + os
 * 8 últimos dígitos, o que faz o nono dígito do celular brasileiro deixar de
 * importar. Um número estrangeiro cai no ramo de baixo, sem massagem.
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountry = digits.length <= 11 ? `55${digits}` : digits

  if (withCountry.startsWith('55') && withCountry.length >= 12) {
    return `55${withCountry.slice(2, 4)}${withCountry.slice(-8)}`
  }

  return withCountry
}

export function buildLeads(input: BuildLeadsInput): AttributedLead[] {
  const campaignByAd = new Map(input.adMap.map((row) => [row.ad_id, row.campaign_id]))
  const campaignById = new Map(
    input.campaigns
      .filter((row): row is CampaignRow & { external_campaign_id: string } =>
        Boolean(row.external_campaign_id)
      )
      .map((row) => [row.external_campaign_id, row])
  )

  // Last touch: quem clicou duas vezes pertence ao anúncio mais recente.
  const latestByPhone = new Map<string, AttributionRow>()
  for (const attr of input.attributions) {
    const key = phoneKey(attr.patient_phone)
    const current = latestByPhone.get(key)
    if (!current || Date.parse(attr.occurred_at) > Date.parse(current.occurred_at)) {
      latestByPhone.set(key, attr)
    }
  }

  const appointmentsByPhone = new Map<string, AppointmentRow[]>()
  for (const appt of input.appointments) {
    const key = phoneKey(appt.patient_phone)
    const list = appointmentsByPhone.get(key)
    if (list) list.push(appt)
    else appointmentsByPhone.set(key, [appt])
  }

  const revenueByAppointment = new Map<string, RevenueRow[]>()
  for (const entry of input.revenue) {
    if (!entry.appointment_id) continue
    const list = revenueByAppointment.get(entry.appointment_id)
    if (list) list.push(entry)
    else revenueByAppointment.set(entry.appointment_id, [entry])
  }

  const leads: AttributedLead[] = []

  for (const [key, attr] of latestByPhone) {
    const campaignId = campaignByAd.get(attr.source_id) ?? null
    const campaign = campaignId ? campaignById.get(campaignId) : undefined

    const leadAtMs = Date.parse(attr.occurred_at)
    const windowEnd = leadAtMs + ATTRIBUTION_WINDOW_DAYS * DAY_MS

    const matched = (appointmentsByPhone.get(key) ?? []).filter((appt) => {
      const at = Date.parse(appt.scheduled_at)
      return at >= leadAtMs && at <= windowEnd
    })

    let paidRevenue = 0
    let forecastRevenue = 0
    for (const appt of matched) {
      if (!appt.id) continue
      for (const entry of revenueByAppointment.get(appt.id) ?? []) {
        const amount = toNumber(entry.amount)
        // Cancelada e reembolsada não são receita nem promessa de receita.
        if (entry.payment_status === 'paid') paidRevenue += amount
        else if (entry.payment_status === 'pending' || entry.payment_status === 'realized') {
          forecastRevenue += amount
        }
      }
    }

    leads.push({
      campaignId,
      campaignName: campaign?.campaign_name ?? null,
      channel: campaign?.channel ?? null,
      patientPhone: attr.patient_phone,
      leadAt: attr.occurred_at,
      appointments: matched.map((appt) => ({ status: appt.status, scheduledAt: appt.scheduled_at })),
      paidRevenue,
      forecastRevenue,
    })
  }

  return leads
}
