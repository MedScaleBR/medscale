import { describe, it, expect } from 'vitest'
import { buildSystemPromptParts, buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import type { BotConfig } from '@/lib/bot/config'

// A parte fixa do prompt vai para o cache da Anthropic. Ela só é reaproveitada
// se sair byte a byte igual entre pacientes e entre mensagens da mesma clínica —
// qualquer horário, data ou dado do paciente dentro dela zera o cache.

const CONFIG: BotConfig = {
  specialty: 'Ortopedia',
  acceptsPrivate: true,
  paymentMethods: [],
  pricingInfo: null,
  examPreparation: null,
  policies: null,
  toneOfVoice: null,
  handoffInstructions: null,
  forbiddenActions: null,
  faq: [],
  handoffMessage: 'Vou te transferir.',
  welcomeMessage: 'Olá! Bem-vindo à clínica.',
  outOfHoursMessage: 'Respondemos no próximo horário comercial.',
  isActive: true,
  phoneNumberId: 'pn-1',
  metaToken: 'enc:token',
  numberSource: 'own',
}

type Input = Parameters<typeof buildSystemPromptParts>[0]

const UNITS: Input['units'] = [
  { id: 'w1', name: 'Unidade Centro', address: 'Rua A, 1', businessHours: null, directionsParking: null, contactInfo: null },
  { id: 'w2', name: 'Unidade Sul', address: 'Rua B, 2', businessHours: null, directionsParking: null, contactInfo: null },
]

function input(overrides: Partial<Input> = {}): Input {
  return {
    accountName: 'Clínica Teste',
    config: CONFIG,
    units: UNITS,
    freeSlotsByUnit: { w1: { '2026-11-12': ['08:00', '09:00'] }, w2: {} },
    procedureCatalogByUnit: {},
    insurancePlans: [],
    isFirstMessage: false,
    upcomingAppointments: [],
    now: new Date('2026-11-10T13:05:00Z'),
    ...overrides,
  }
}

describe('buildSystemPromptParts — separação para o cache', () => {
  it('a parte fixa não muda com hora, horários livres, consultas, primeira mensagem nem unidade da conversa', () => {
    const a = buildSystemPromptParts(input())
    const b = buildSystemPromptParts(
      input({
        now: new Date('2026-11-10T19:47:00Z'),
        freeSlotsByUnit: { w1: {}, w2: { '2026-11-13': ['14:00'] } },
        upcomingAppointments: [{ id: 'appt-1', label: '13 de novembro às 14:00 — Unidade Sul' }],
        isFirstMessage: true,
        currentUnitName: 'Unidade Sul',
      })
    )
    expect(b.stable).toBe(a.stable)
  })

  it('a parte variável leva a data, os horários livres e as consultas do paciente', () => {
    const { stable, dynamic } = buildSystemPromptParts(
      input({ upcomingAppointments: [{ id: 'appt-1', label: '13 de novembro às 14:00 — Unidade Sul' }] })
    )
    expect(dynamic).toContain('Data atual: 2026-11-10')
    expect(dynamic).toContain('Horários disponíveis para agendamento')
    expect(dynamic).toContain('08:00, 09:00')
    expect(dynamic).toContain('appt-1')
    expect(stable).not.toContain('2026-11-10')
    expect(stable).not.toContain('appt-1')
    expect(stable).not.toContain('08:00, 09:00')
  })

  it('a primeira mensagem e a unidade já escolhida ficam só na parte variável', () => {
    const { stable, dynamic } = buildSystemPromptParts(input({ isFirstMessage: true, currentUnitName: 'Unidade Sul' }))
    expect(dynamic).toContain('Primeira mensagem desta conversa')
    expect(dynamic).toContain('já mencionou a Unidade Sul')
    expect(stable).not.toContain('Primeira mensagem desta conversa')
  })

  it('as regras de segurança abrem a parte fixa', () => {
    const { stable } = buildSystemPromptParts(input())
    expect(stable.startsWith('## Segurança')).toBe(true)
  })

  it('o prompt inteiro é a parte fixa seguida da variável', () => {
    const parts = buildSystemPromptParts(input())
    expect(buildDynamicSystemPrompt(input())).toBe(parts.stable + parts.dynamic)
  })
})
