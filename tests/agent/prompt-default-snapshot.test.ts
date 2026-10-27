import { describe, it, expect } from 'vitest'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import type { BotConfig } from '@/lib/bot/config'

// Trava o prompt de uma account sem nenhuma configuração da Clara por unidade.
// O snapshot foi gravado ANTES da configuração por unidade existir: qualquer
// diferença aqui significa que uma unidade no padrão mudou de comportamento.
const CONFIG: BotConfig = {
  specialty: 'Ortopedia',
  acceptsPrivate: true,
  paymentMethods: ['Pix', 'Cartão'],
  pricingInfo: 'Consulta R$300',
  examPreparation: 'Jejum de 8h',
  policies: 'Tolerância de 15 minutos',
  toneOfVoice: 'Leve e acolhedor',
  handoffInstructions: 'Reclamação de cobrança',
  forbiddenActions: 'Não falar de cirurgia',
  faq: [{ question: 'Tem estacionamento?', answer: 'Sim, conveniado.' }],
  handoffMessage: 'Vou te transferir.',
  welcomeMessage: 'Olá! Bem-vindo.',
  outOfHoursMessage: 'Respondemos amanhã.',
  isActive: true,
  phoneNumberId: 'pn-1',
  metaToken: 'enc',
  numberSource: 'own',
}

const UNITS = [
  { id: 'w1', name: 'Unidade Centro', address: 'Rua A, 1', businessHours: 'segunda-feira: 08:00–12:00', directionsParking: 'Subsolo', contactInfo: '(11) 1111-1111' },
  { id: 'w2', name: 'Unidade Sul', address: 'Rua B, 2', businessHours: null, directionsParking: null, contactInfo: null },
]

function build(units: typeof UNITS, isFirstMessage: boolean) {
  return buildDynamicSystemPrompt({
    accountName: 'Clínica Teste',
    config: CONFIG,
    units,
    freeSlotsByUnit: { w1: { '2026-10-28': ['08:00', '08:30'] }, w2: {} },
    procedureCatalogByUnit: { w1: [{ id: 'p1', name: 'Consulta', price: 300 }] },
    insurancePlans: ['Unimed'],
    insurers: [{ id: 'i1', name: 'Unimed' }],
    isFirstMessage,
    upcomingAppointments: [{ id: 'a1', label: 'terça-feira, 3 de novembro às 08:00 — Unidade Centro' }],
    now: new Date('2026-10-27T13:00:00Z'),
    currentUnitName: 'Unidade Centro',
    waitlistEnabled: true,
  })
}

describe('prompt de account sem configuração por unidade', () => {
  it('multiunidade: igual ao prompt de antes da configuração por unidade', async () => {
    await expect(build(UNITS, true)).toMatchFileSnapshot('./__snapshots__/prompt-default-multi.txt')
  })

  it('unidade única: igual ao prompt de antes da configuração por unidade', async () => {
    await expect(build([UNITS[0]], false)).toMatchFileSnapshot('./__snapshots__/prompt-default-single.txt')
  })
})
