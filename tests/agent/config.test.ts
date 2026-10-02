import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseMock, type SupabaseMockConfig, type SupabaseMock } from '../helpers/supabase-mock'

const g = vi.hoisted(() => ({ supabase: null as unknown as SupabaseMock }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => g.supabase.client,
  createClient: async () => g.supabase.client,
}))

import { getAccountUnits, getBotConfig, invalidateBotConfigCache } from '@/lib/bot/config'

const ROW = {
  specialty: 'Ortopedia',
  accepts_private: true,
  payment_methods: ['pix', 'cartão'],
  pricing_info: null,
  exam_preparation: null,
  policies: null,
  tone_of_voice: null,
  handoff_instructions: null,
  forbidden_actions: null,
  faq: [{ question: 'Aceita convênio?', answer: 'Sim, Unimed.' }],
  handoff_message: 'Vou te transferir.',
  welcome_message: 'Olá!',
  out_of_hours_message: 'Respondemos amanhã.',
  is_active: true,
  phone_number_id: 'pn-1',
  meta_token: 'enc:token-1',
}

function setup(config: SupabaseMockConfig = {}) {
  g.supabase = createSupabaseMock({ bot_config: { select: { data: ROW } }, ...config })
  return g.supabase
}

// Cada teste usa uma account diferente porque o cache é global ao processo.
let counter = 0
function nextWorkspace() {
  counter += 1
  return `acc-cache-${counter}`
}

describe('getAccountUnits — expediente presencial', () => {
  it('informa o expediente de cada unidade sem reutilizar o texto livre antigo', async () => {
    const supabase = setup({
      workspaces: { select: { data: [
        { id: 'w1', name: 'Centro', business_hours: '24 horas', address: null },
        { id: 'w2', name: 'Sul', business_hours: '24 horas', address: null },
      ] } },
      availability_rules: { select: { data: [
        { workspace_id: 'w1', day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00' },
        { workspace_id: 'w1', day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00' },
        { workspace_id: 'w1', day_of_week: 1, start_time: '14:00:00', end_time: '18:00:00' },
        { workspace_id: 'w2', day_of_week: 6, start_time: '09:00:00', end_time: '13:00:00' },
      ] } },
    })

    const units = await getAccountUnits('account-1')

    expect(units[0].businessHours).toBe('segunda-feira: 08:00–12:00, 14:00–18:00 (America/Sao_Paulo)')
    expect(units[1].businessHours).toBe('sábado: 09:00–13:00 (America/Sao_Paulo)')
    expect(supabase.callsTo('availability_rules', 'select')[0].filters).toContainEqual(['in', 'workspace_id', ['w1', 'w2']])
    expect(supabase.callsTo('availability_rules', 'select')[0].filters).toContainEqual(['eq', 'is_active', true])
  })

  it('não informa texto antigo quando a unidade ainda não tem expediente', async () => {
    setup({ workspaces: { select: { data: [{ id: 'w1', name: 'Centro', business_hours: '24 horas' }] } } })
    expect((await getAccountUnits('account-1'))[0].businessHours).toBeNull()
  })

  it('não consulta expediente quando não há unidades ativas', async () => {
    const supabase = setup({ workspaces: { select: { data: [] } } })
    expect(await getAccountUnits('account-1')).toEqual([])
    expect(supabase.callsTo('availability_rules', 'select')).toHaveLength(0)
  })
})

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
      acceptsPrivate: true,
      welcomeMessage: 'Olá!',
      outOfHoursMessage: 'Respondemos amanhã.',
      isActive: true,
      phoneNumberId: 'pn-1',
      metaToken: 'enc:token-1',
    })
  })

  it('deve usar arrays vazios quando as colunas de lista vêm null', async () => {
    setup({
      bot_config: {
        select: { data: { ...ROW, payment_methods: null, faq: null } },
      },
    })
    const config = await getBotConfig(nextWorkspace())

    expect(config).toMatchObject({ paymentMethods: [], faq: [] })
  })

  it('deve devolver null quando não existe configuração para a account', async () => {
    setup({ bot_config: { select: { data: null, error: { message: 'no rows' } } } })
    expect(await getBotConfig(nextWorkspace())).toBeNull()
  })

  it('deve consultar o banco uma única vez em chamadas seguidas da mesma account', async () => {
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
