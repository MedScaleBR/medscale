import { describe, it, expect } from 'vitest'
import { buildLeads, leadsByCampaign, leadsWithinPeriod, ATTRIBUTION_WINDOW_DAYS } from '@/lib/trafego/attribution'
import type { AttributedLead } from '@/lib/trafego/attribution'

const ATTR = {
  patient_phone: '+5511999999999',
  source_id: 'a1',
  occurred_at: '2026-09-01T10:00:00Z',
}

const empty = { attributions: [], adMap: [], campaigns: [], appointments: [], revenue: [] }

describe('buildLeads', () => {
  it('liga o lead à campanha pelo mapa de anúncios', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [ATTR],
      adMap: [{ ad_id: 'a1', campaign_id: 'c1' }],
      campaigns: [{ external_campaign_id: 'c1', campaign_name: 'Implantes', channel: 'facebook' }],
    })

    expect(leads[0]).toMatchObject({ campaignId: 'c1', campaignName: 'Implantes', channel: 'facebook' })
  })

  // Anúncio criado depois do último sync ainda não está no mapa. O lead existe
  // e precisa aparecer — some da tabela por campanha, não do total de leads.
  it('mantém o lead mesmo sem mapa do anúncio', () => {
    const leads = buildLeads({ ...empty, attributions: [ATTR] })

    expect(leads).toHaveLength(1)
    expect(leads[0].campaignId).toBeNull()
  })

  it('só conta consulta dentro da janela de 90 dias após o lead', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [ATTR],
      adMap: [{ ad_id: 'a1', campaign_id: 'c1' }],
      appointments: [
        { id: 'ap1', patient_phone: '+5511999999999', status: 'realizado', scheduled_at: '2026-09-10T10:00:00Z' },
        { id: 'ap2', patient_phone: '+5511999999999', status: 'realizado', scheduled_at: '2027-06-01T10:00:00Z' },
      ],
    })

    expect(leads[0].appointments).toHaveLength(1)
  })

  it('ignora consulta anterior ao lead — não foi o anúncio que a trouxe', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [ATTR],
      appointments: [
        { id: 'ap1', patient_phone: '+5511999999999', status: 'realizado', scheduled_at: '2026-08-01T10:00:00Z' },
      ],
    })

    expect(leads[0].appointments).toHaveLength(0)
  })

  // O webhook grava o telefone cru ("5511999999999"), a recepção digita com
  // máscara ("+55 (11) 99999-9999"). Comparar string com string perderia a
  // consulta em silêncio — e o lead apareceria eternamente sem conversão.
  it('casa o telefone mesmo com formatação diferente dos dois lados', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [{ ...ATTR, patient_phone: '5511999999999' }],
      appointments: [
        { id: 'ap1', patient_phone: '+55 (11) 99999-9999', status: 'realizado', scheduled_at: '2026-09-10T10:00:00Z' },
      ],
    })

    expect(leads[0].appointments).toHaveLength(1)
  })

  // Last touch: quem clicou duas vezes pertence ao anúncio mais recente.
  it('mantém uma linha por telefone, a atribuição mais recente', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [
        { ...ATTR, source_id: 'a1', occurred_at: '2026-09-01T10:00:00Z' },
        { ...ATTR, source_id: 'a2', occurred_at: '2026-09-05T10:00:00Z' },
      ],
      adMap: [
        { ad_id: 'a1', campaign_id: 'c1' },
        { ad_id: 'a2', campaign_id: 'c2' },
      ],
    })

    expect(leads).toHaveLength(1)
    expect(leads[0].campaignId).toBe('c2')
  })

  it('soma só a receita paga em paidRevenue, e a que ainda vem em forecast', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [ATTR],
      appointments: [
        { id: 'ap1', patient_phone: '+5511999999999', status: 'realizado', scheduled_at: '2026-09-10T10:00:00Z' },
      ],
      revenue: [
        { appointment_id: 'ap1', amount: 1000, payment_status: 'paid' },
        { appointment_id: 'ap1', amount: 300, payment_status: 'realized' },
        { appointment_id: 'ap1', amount: 200, payment_status: 'pending' },
        { appointment_id: 'ap1', amount: 900, payment_status: 'cancelled' },
      ],
    })

    expect(leads[0].paidRevenue).toBe(1000)
    // 'realized' é "aguardando pagamento" — dinheiro que ainda vem, não recebido.
    expect(leads[0].forecastRevenue).toBe(500)
  })

  it('não conta receita de consulta que não é do lead', () => {
    const leads = buildLeads({
      ...empty,
      attributions: [ATTR],
      appointments: [],
      revenue: [{ appointment_id: 'ap-de-outro', amount: 5000, payment_status: 'paid' }],
    })

    expect(leads[0].paidRevenue).toBe(0)
  })

  it('a janela de atribuição é de 90 dias', () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(90)
  })
})

describe('leadsWithinPeriod', () => {
  const today = new Date('2026-09-18T15:00:00Z')
  const lead = (leadAt: string): AttributedLead => ({
    campaignId: 'c1',
    campaignName: 'x',
    channel: 'facebook',
    patientPhone: '+5511999999999',
    leadAt,
    appointments: [],
    paidRevenue: 0,
    forecastRevenue: 0,
  })

  // A janela inclui hoje, como em `withinPeriod`: 7 dias vai de hoje até seis
  // dias atrás. As duas telas precisam contar o mesmo período.
  it('mantém o lead de hoje e o do sexto dia atrás numa janela de 7', () => {
    const kept = leadsWithinPeriod(
      [lead('2026-09-18T09:00:00Z'), lead('2026-09-12T23:00:00Z')],
      7,
      today
    )

    expect(kept).toHaveLength(2)
  })

  it('descarta o lead que caiu fora da janela', () => {
    const kept = leadsWithinPeriod([lead('2026-09-11T09:00:00Z')], 7, today)

    expect(kept).toHaveLength(0)
  })

  // Hora do dia não pode decidir: o lead das 23h de hoje é de hoje.
  it('compara por dia, não por hora cheia', () => {
    const kept = leadsWithinPeriod([lead('2026-09-18T23:59:00Z')], 7, today)

    expect(kept).toHaveLength(1)
  })
})

describe('leadsByCampaign', () => {
  const lead = (over: Partial<AttributedLead>): AttributedLead => ({
    campaignId: 'c1',
    campaignName: 'Implantes',
    channel: 'facebook',
    patientPhone: '+5511999999999',
    leadAt: '2026-09-01T10:00:00Z',
    appointments: [],
    paidRevenue: 0,
    forecastRevenue: 0,
    ...over,
  })

  it('agrupa por campanha e calcula o percentual sobre o total', () => {
    const lines = leadsByCampaign([
      lead({}),
      lead({}),
      lead({ campaignId: 'c2', campaignName: 'Clareamento' }),
      lead({ campaignId: 'c2', campaignName: 'Clareamento' }),
      lead({ campaignId: 'c2', campaignName: 'Clareamento' }),
    ])

    expect(lines[0]).toMatchObject({ campaignId: 'c2', leads: 3, pct: 60 })
    expect(lines[1]).toMatchObject({ campaignId: 'c1', leads: 2, pct: 40 })
  })

  // Anúncio fora do mapa vira uma linha só, em vez de sumir: se sumisse, a
  // soma da lista não bateria com o total de leads logo acima dela.
  it('junta os leads sem campanha numa linha própria', () => {
    const lines = leadsByCampaign([
      lead({ campaignId: null, campaignName: null, channel: null }),
      lead({ campaignId: null, campaignName: null, channel: null }),
    ])

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ campaignId: null, leads: 2, pct: 100 })
  })

  it('sem lead nenhum devolve lista vazia, não uma linha zerada', () => {
    expect(leadsByCampaign([])).toEqual([])
  })
})
