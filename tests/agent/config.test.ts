import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))

import { getBotConfig, invalidateBotConfigCache } from '@/lib/bot/config'

const ROW = {
  specialty: 'Ortopedia',
  procedures: ['consulta', 'infiltração'],
  insurance_plans: ['Unimed'],
  accepts_private: true,
  consultation_price_from: '350.00',
  business_hours: 'Seg a sex, 8h às 17h',
  address: 'Rua Teste, 100',
  directions_parking: 'Estacionamento no local',
  contact_info: 'contato@clinica.com',
  payment_methods: ['pix', 'cartão'],
  pricing_info: null,
  exam_preparation: null,
  policies: null,
  tone_of_voice: null,
  handoff_instructions: null,
  forbidden_actions: null,
  faq: [{ question: 'Aceita convênio?', answer: 'Sim, Unimed.' }],
  handoff_number: '+5511999998888',
  handoff_message: 'Vou te transferir.',
  welcome_message: 'Olá!',
  out_of_hours_message: 'Respondemos amanhã.',
  is_active: true,
}

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ bot_config: { select: { data: ROW } }, ...config })
  return g.supabase
}

// Cada teste usa uma workspace diferente porque o cache é global ao processo.
let counter = 0
function nextWorkspace() {
  counter += 1
  return `w-cache-${counter}`
}

describe('getBotConfig — leitura e cache da configuração do bot', () => {
  beforeEach(() => {
    setup()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve mapear as colunas do banco para o formato usado pelo agente', async () => {
    const config = await getBotConfig(nextWorkspace())

    expect(config).toMatchObject({
      specialty: 'Ortopedia',
      procedures: ['consulta', 'infiltração'],
      insurancePlans: ['Unimed'],
      acceptsPrivate: true,
      consultationPriceFrom: 350,
      handoffNumber: '+5511999998888',
      welcomeMessage: 'Olá!',
      outOfHoursMessage: 'Respondemos amanhã.',
      isActive: true,
    })
  })

  it('deve converter o preço de string para número', async () => {
    const config = await getBotConfig(nextWorkspace())
    expect(typeof config?.consultationPriceFrom).toBe('number')
  })

  it('deve usar arrays vazios quando as colunas de lista vêm null', async () => {
    setup({
      bot_config: {
        select: { data: { ...ROW, procedures: null, insurance_plans: null, payment_methods: null, faq: null } },
      },
    })
    const config = await getBotConfig(nextWorkspace())

    expect(config).toMatchObject({ procedures: [], insurancePlans: [], paymentMethods: [], faq: [] })
  })

  it('deve devolver null quando não existe configuração para a workspace', async () => {
    setup({ bot_config: { select: { data: null, error: { message: 'no rows' } } } })
    expect(await getBotConfig(nextWorkspace())).toBeNull()
  })

  it('deve devolver null quando o preço não está configurado', async () => {
    setup({ bot_config: { select: { data: { ...ROW, consultation_price_from: null } } } })
    const config = await getBotConfig(nextWorkspace())
    expect(config?.consultationPriceFrom).toBeNull()
  })

  it('deve consultar o banco uma única vez em chamadas seguidas da mesma workspace', async () => {
    const supabase = setup()
    const workspace = nextWorkspace()

    await getBotConfig(workspace)
    await getBotConfig(workspace)
    await getBotConfig(workspace)

    expect(supabase.callsTo('bot_config', 'select')).toHaveLength(1)
  })

  it('deve consultar o banco de novo depois do TTL de 5 minutos', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-09-15T12:00:00-03:00'))
    const supabase = setup()
    const workspace = nextWorkspace()

    await getBotConfig(workspace)
    vi.setSystemTime(new Date('2025-09-15T12:05:01-03:00'))
    await getBotConfig(workspace)

    expect(supabase.callsTo('bot_config', 'select')).toHaveLength(2)
  })

  it('deve consultar o banco de novo depois de invalidar o cache', async () => {
    const supabase = setup()
    const workspace = nextWorkspace()

    await getBotConfig(workspace)
    invalidateBotConfigCache(workspace)
    await getBotConfig(workspace)

    expect(supabase.callsTo('bot_config', 'select')).toHaveLength(2)
  })

  it('não deve compartilhar cache entre workspaces diferentes', async () => {
    const supabase = setup()

    await getBotConfig(nextWorkspace())
    await getBotConfig(nextWorkspace())

    expect(supabase.callsTo('bot_config', 'select')).toHaveLength(2)
  })
})
