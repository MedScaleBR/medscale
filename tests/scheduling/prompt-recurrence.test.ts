import { describe, it, expect } from 'vitest'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import type { BotConfig } from '@/lib/bot/config'
import type { WorkspaceBotSettings } from '@/lib/bot/unit-settings'
import { attendsOn, closedDayMessage, type ScheduleRule } from '@/lib/bot/working-days'

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
  welcomeMessage: 'Olá!',
  outOfHoursMessage: 'Respondemos amanhã.',
  isActive: true,
  phoneNumberId: 'pn-1',
  metaToken: 'enc',
  numberSource: 'own',
}

const base = { address: null, businessHours: null, directionsParking: null, contactInfo: null }
const external: WorkspaceBotSettings = { schedulingMode: 'external', intakeFields: ['full_name', 'insurance', 'preference'], botInstructions: null }

// Hoje: quarta 12/11/2025. Quinzenal às terças com âncora 11/11.
const BIWEEKLY: ScheduleRule = { day_of_week: 2, start_time: '08:00', end_time: '12:00', interval_weeks: 2, anchor_date: '2025-11-11' }
const WEEKLY: ScheduleRule = { day_of_week: 4, start_time: '14:00', end_time: '18:00', interval_weeks: 1, anchor_date: null }

function build(units: Parameters<typeof buildDynamicSystemPrompt>[0]['units']) {
  return buildDynamicSystemPrompt({
    accountName: 'Clínica Teste',
    config: CONFIG,
    units,
    freeSlotsByUnit: { w1: { '2025-11-25': ['08:00'] }, w2: { '2025-11-13': ['14:00'] } },
    procedureCatalogByUnit: {},
    insurancePlans: [],
    isFirstMessage: false,
    upcomingAppointments: [],
    now: new Date('2025-11-12T13:00:00Z'),
  })
}

describe('prompt — expediente a cada N semanas', () => {
  it('unidade interna quinzenal ganha a linha do expediente; a semanal fica igual', () => {
    const withRule = build([
      { id: 'w1', name: 'Centro', ...base, workingDays: [2], scheduleRules: [BIWEEKLY] },
      { id: 'w2', name: 'Sul', ...base, workingDays: [4], scheduleRules: [WEEKLY] },
    ])
    expect(withRule).toContain('### Centro\nAtendimento nesta unidade: terças, quinzenalmente, 08:00–12:00.\n')
    expect(withRule).toContain('### Sul\n  •')
    expect(withRule).toContain('Dias de atendimento: terças, quinzenalmente, 08:00–12:00')
  })

  it('só regras semanais: prompt idêntico ao de antes', () => {
    const before = build([
      { id: 'w1', name: 'Centro', ...base, workingDays: [4] },
      { id: 'w2', name: 'Sul', ...base, workingDays: [4] },
    ])
    const after = build([
      { id: 'w1', name: 'Centro', ...base, workingDays: [4], scheduleRules: [WEEKLY] },
      { id: 'w2', name: 'Sul', ...base, workingDays: [4], scheduleRules: [WEEKLY] },
    ])
    expect(after).toBe(before)
  })

  it('agenda externa: expediente, 3 próximas datas (sem as bloqueadas) e a instrução', () => {
    const prompt = build([
      { id: 'w1', name: 'Centro', ...base },
      {
        id: 'w3',
        name: 'IAD Pituba',
        ...base,
        workingDays: [2],
        scheduleRules: [BIWEEKLY],
        blockedDates: ['2025-12-09'],
        botSettings: external,
      },
    ])
    expect(prompt).toContain('— atende terças, quinzenalmente, 08:00–12:00. Próximas datas: ter 25/11, ter 23/12, ter 06/01.')
    expect(prompt).toContain('Deixe claro que o horário exato é confirmado pela equipe com a clínica.')
    expect(prompt).toContain('PREFERENCIA_HORARIO')
  })

  it('agenda externa sem expediente: sem datas nem instrução', () => {
    const prompt = build([{ id: 'w1', name: 'Centro', ...base }, { id: 'w3', name: 'IAD', ...base, botSettings: external }])
    expect(prompt).not.toContain('Próximas datas')
    expect(prompt).not.toContain('Quando a unidade tiver próximas datas listadas')
  })
})

describe('dias de atendimento com repetição', () => {
  const unit = { workingDays: [2], scheduleRules: [BIWEEKLY] }

  it('attendsOn: terça certa sim, terça errada não', () => {
    expect(attendsOn(unit, '2025-11-25')).toBe(true)
    expect(attendsOn(unit, '2025-11-18')).toBe(false)
    expect(attendsOn({ ...unit, extraDates: ['2025-11-18'] }, '2025-11-18')).toBe(true)
  })

  it('mensagem explica a quinzena e dá as próximas datas', () => {
    expect(closedDayMessage('Centro', [2], unit, '2025-11-12')).toBe(
      'A unidade Centro atende terças, quinzenalmente, 08:00–12:00. As próximas datas são ter 25/11, ter 09/12 e ter 23/12. Qual fica melhor para você?'
    )
    // Sem regra repetida: mensagem de antes.
    expect(closedDayMessage('Sul', [4], { workingDays: [4], scheduleRules: [WEEKLY] }, '2025-11-12')).toBe(
      'A unidade Sul atende só às quintas. Qual desses dias fica melhor para você?'
    )
  })
})
