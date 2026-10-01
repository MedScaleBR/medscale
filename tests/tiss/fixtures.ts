import type { BatchGuide, GuidePayload, GuideType } from '@/lib/billing/types'

// Dados 100% fictícios — registro ANS, CNES, CRM e carteirinhas inventados.
export function fakePayload(overrides: Partial<{ guide_type: GuideType; card: string; name: string }> = {}): GuidePayload {
  return {
    insurer: { ans_registry: '999999', provider_code: 'PREST0001', tiss_version: '4.03.00' },
    provider: { cnes: '1234567', cnpj: '11222333000181', legal_name: 'Clínica Fictícia São João Ltda' },
    professional: { name: 'Dra. Maria Exemplo', crm: '123456/SP', crm_uf: 'SP', cbo_code: '225125' },
    beneficiary: {
      card_number: overrides.card ?? '00001111222233334',
      name: overrides.name ?? 'Paciente Fictício',
      valid_until: '2027-12-31',
    },
    service: {
      date: '2026-09-29',
      guide_type: overrides.guide_type ?? 'consulta',
      is_return: false,
      tuss_code: '10101012',
      description: 'Consulta em consultório',
      price_cents: 15050,
      authorization_number: null,
      authorization_date: null,
      cid10: 'J06.9',
    },
  }
}

export function fakeGuides(count: number, guideType: GuideType = 'consulta'): BatchGuide[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `g${i + 1}`,
    provider_guide_number: String(i + 1),
    guide_type: guideType,
    payload: fakePayload({ guide_type: guideType, card: `0000111122223333${i}` }),
  }))
}

export const FAKE_INSURER = { ans_registry: '999999', provider_code: 'PREST0001' }

// 29/09/2026 21:30:00 UTC = 18:30:00 em São Paulo
export const FIXED_NOW = new Date('2026-09-29T21:30:00Z')
