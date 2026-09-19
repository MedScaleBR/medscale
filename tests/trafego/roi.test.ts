import { describe, it, expect } from 'vitest'
import { roiByCampaign } from '@/lib/trafego/roi'
import type { AttributedLead } from '@/lib/trafego/attribution'

const lead = (over: Partial<AttributedLead>): AttributedLead => ({
  campaignId: 'c1',
  campaignName: 'x',
  channel: 'facebook',
  patientPhone: '+551199',
  leadAt: '2026-09-01T10:00:00Z',
  appointments: [],
  paidRevenue: 0,
  forecastRevenue: 0,
  ...over,
})

describe('roiByCampaign', () => {
  it('divide a receita paga pelo investimento da campanha', () => {
    const result = roiByCampaign([lead({ paidRevenue: 3000 })], [{ externalId: 'c1', spend: 1000 }])

    expect(result.get('c1')).toMatchObject({ revenue: 3000, roi: 3 })
  })

  // Investimento zero com receita > 0 daria Infinity e imprimiria "∞x" na tela.
  it('com investimento zero o ROI é nulo, não infinito', () => {
    const result = roiByCampaign([lead({ paidRevenue: 500 })], [{ externalId: 'c1', spend: 0 }])

    expect(result.get('c1')?.roi).toBeNull()
  })

  it('campanha que gastou e não gerou receita tem ROI zero, não nulo', () => {
    const result = roiByCampaign([], [{ externalId: 'c1', spend: 800 }])

    expect(result.get('c1')?.roi).toBe(0)
  })

  it('não conta receita prevista no ROI principal', () => {
    const result = roiByCampaign(
      [lead({ paidRevenue: 0, forecastRevenue: 9000 })],
      [{ externalId: 'c1', spend: 1000 }]
    )

    expect(result.get('c1')?.roi).toBe(0)
  })

  it('soma a receita de vários leads da mesma campanha', () => {
    const result = roiByCampaign(
      [lead({ paidRevenue: 1000 }), lead({ paidRevenue: 500 })],
      [{ externalId: 'c1', spend: 500 }]
    )

    expect(result.get('c1')).toMatchObject({ revenue: 1500, roi: 3 })
  })

  // Campanha manual não tem id externo. Agrupar todas sob a chave nula somaria
  // campanhas diferentes numa só.
  it('ignora campanha sem id externo', () => {
    const result = roiByCampaign([], [{ externalId: null, spend: 800 }])

    expect(result.size).toBe(0)
  })

  it('ignora lead cujo anúncio ainda não tem campanha', () => {
    const result = roiByCampaign(
      [lead({ campaignId: null, paidRevenue: 9999 })],
      [{ externalId: 'c1', spend: 100 }]
    )

    expect(result.get('c1')?.revenue).toBe(0)
  })
})
