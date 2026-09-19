import { createClient } from '@/lib/supabase/server'
import { resolveActiveSession } from '@/lib/session/server'
import { buildLeads, type AttributedLead } from '@/lib/trafego/attribution'
import { CampaignsClient } from '@/components/trafego/CampaignsClient'

// A janela mais larga do seletor. Buscar só isso evita trazer o histórico
// inteiro (uma linha por campanha por dia) para uma tela que não o mostra.
const MAX_WINDOW_DAYS = 90

export default async function TrafegoPage() {
  const session = await resolveActiveSession()
  if (!session) return null

  const today = new Date()
  const since = new Date(today.getTime() - MAX_WINDOW_DAYS * 86_400_000)
  const sinceDate = since.toISOString().slice(0, 10)

  const supabase = await createClient()

  // A atribuição é da account (o `referral` chega no webhook, que não sabe de
  // workspace); campanhas, agenda e receita são do workspace aberto.
  const [{ data: campaigns }, { data: attributions }, { data: adMap }] = await Promise.all([
    supabase
      .from('ad_campaigns')
      .select('*')
      .eq('workspace_id', session.workspaceId)
      .gte('period_start', sinceDate)
      .order('period_start', { ascending: false }),
    supabase
      .from('lead_attributions')
      .select('patient_phone, source_id, occurred_at')
      .eq('account_id', session.accountId)
      .gte('occurred_at', since.toISOString()),
    supabase.from('meta_ad_map').select('ad_id, campaign_id').eq('account_id', session.accountId),
  ])

  // Sem lead vindo de anúncio não há o que cruzar, e agenda e receita de 90
  // dias são as duas maiores tabelas da tela. Clínica que ainda não rodou
  // anúncio de clique-para-WhatsApp não paga por essas buscas.
  let leads: AttributedLead[] = []
  if (attributions && attributions.length > 0) {
    const [{ data: appointments }, { data: revenue }] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, patient_phone, status, scheduled_at')
        .eq('workspace_id', session.workspaceId)
        .gte('scheduled_at', since.toISOString()),
      supabase
        .from('revenue_entries')
        .select('appointment_id, amount, payment_status')
        .eq('workspace_id', session.workspaceId)
        .not('appointment_id', 'is', null)
        .gte('entry_date', sinceDate),
    ])

    leads = buildLeads({
      attributions,
      adMap: adMap ?? [],
      campaigns: campaigns ?? [],
      appointments: appointments ?? [],
      revenue: revenue ?? [],
    })
  }

  return (
    <CampaignsClient
      initialCampaigns={campaigns ?? []}
      leads={leads}
      today={today.toISOString()}
    />
  )
}
