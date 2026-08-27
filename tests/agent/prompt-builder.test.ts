import { describe, it, expect } from 'vitest'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import type { BotConfig } from '@/lib/bot/config'

const BASE: BotConfig = {
  specialty: 'Ortopedia',
  procedures: [],
  insurancePlans: [],
  acceptsPrivate: true,
  consultationPriceFrom: null,
  businessHours: null,
  address: null,
  directionsParking: null,
  contactInfo: null,
  paymentMethods: [],
  pricingInfo: null,
  examPreparation: null,
  policies: null,
  toneOfVoice: null,
  handoffInstructions: null,
  forbiddenActions: null,
  faq: [],
  handoffNumber: null,
  handoffMessage: 'Vou te transferir.',
  welcomeMessage: 'Olá! Bem-vindo à clínica.',
  outOfHoursMessage: 'Respondemos no próximo horário comercial.',
  isActive: true,
}

function build(config: Partial<BotConfig> = {}, overrides: Record<string, unknown> = {}) {
  return buildDynamicSystemPrompt({
    workspaceName: 'Clínica Teste',
    config: { ...BASE, ...config },
    freeSlotsByDay: {},
    isFirstMessage: false,
    upcomingAppointments: [],
    ...overrides,
  })
}

describe('buildDynamicSystemPrompt — convênios e valores', () => {
  it('deve informar atendimento só particular quando não há convênios', () => {
    expect(build({ insurancePlans: [], acceptsPrivate: true })).toContain('Atendimento apenas particular')
  })

  it('deve listar os convênios e mencionar particular quando aceita os dois', () => {
    const prompt = build({ insurancePlans: ['Unimed', 'Bradesco'], acceptsPrivate: true })
    expect(prompt).toContain('Convênios aceitos: Unimed, Bradesco')
    expect(prompt).toContain('Também atende particular')
  })

  it('deve dizer que não atende particular quando só aceita convênio', () => {
    expect(build({ insurancePlans: ['Unimed'], acceptsPrivate: false })).toContain('Não atende particular')
  })

  it('deve mandar consultar a equipe quando não há convênio nem particular', () => {
    expect(build({ insurancePlans: [], acceptsPrivate: false })).toContain('Consulte a equipe')
  })

  it('deve informar o preço configurado sem centavos', () => {
    expect(build({ consultationPriceFrom: 350 })).toContain('R$350')
  })

  it('não deve inventar preço quando não há valor configurado', () => {
    const prompt = build({ consultationPriceFrom: null })
    expect(prompt).toContain('a equipe entrará em contato')
    expect(prompt).not.toContain('R$')
  })
})

describe('buildDynamicSystemPrompt — horários disponíveis', () => {
  it('deve listar os horários livres por dia', () => {
    const prompt = build({}, { freeSlotsByDay: { '2025-09-15': ['08:00', '08:30', '09:00'] } })
    expect(prompt).toContain('2025-09-15')
    expect(prompt).toContain('08:00, 08:30, 09:00')
  })

  it('deve resumir quando o dia tem mais de 6 horários', () => {
    const prompt = build(
      {},
      { freeSlotsByDay: { '2025-09-15': ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] } }
    )
    expect(prompt).toContain('e mais 2')
  })

  it('deve avisar quando não há nenhum horário disponível', () => {
    expect(build({}, { freeSlotsByDay: {} })).toContain('Sem horários disponíveis')
  })

  it('deve deixar explícito que os horários estão no fuso de São Paulo', () => {
    expect(build()).toContain('America/Sao_Paulo')
  })
})

describe('buildDynamicSystemPrompt — consultas já agendadas', () => {
  it('deve listar as consultas existentes com o id interno', () => {
    const prompt = build(
      {},
      { upcomingAppointments: [{ id: 'appt-1', label: 'segunda-feira, 15 de setembro às 10:00' }] }
    )
    expect(prompt).toContain('segunda-feira, 15 de setembro às 10:00 (id: appt-1)')
  })

  it('deve dizer que não há consulta futura quando a lista está vazia', () => {
    expect(build({}, { upcomingAppointments: [] })).toContain('Nenhuma consulta futura agendada')
  })

  it('deve instruir a nunca inventar uma consulta fora da lista', () => {
    expect(build()).toContain('nunca invente uma consulta que não está nesta lista')
  })
})

describe('buildDynamicSystemPrompt — boas-vindas e handoff', () => {
  it('deve incluir a mensagem de boas-vindas na primeira mensagem', () => {
    const prompt = build({}, { isFirstMessage: true })
    expect(prompt).toContain('Primeira mensagem desta conversa')
    expect(prompt).toContain('Olá! Bem-vindo à clínica.')
  })

  it('não deve incluir a instrução de boas-vindas fora da primeira mensagem', () => {
    expect(build({}, { isFirstMessage: false })).not.toContain('Primeira mensagem desta conversa')
  })

  it('deve instruir o uso do marcador [HANDOFF] quando há número configurado', () => {
    const prompt = build({ handoffNumber: '+5511999998888' })
    expect(prompt).toContain('[HANDOFF]')
    // O número em si nunca vai para o prompt — quem envia é o sistema.
    expect(prompt).not.toContain('+5511999998888')
  })

  it('deve orientar resposta genérica quando não há número de handoff', () => {
    const prompt = build({ handoffNumber: null })
    expect(prompt).toContain('Nossa equipe entrará em contato em breve')
  })
})

describe('buildDynamicSystemPrompt — seções opcionais e regras clínicas', () => {
  it('deve incluir endereço, estacionamento e contatos quando configurados', () => {
    const prompt = build({
      address: 'Rua Teste, 100',
      directionsParking: 'Estacionamento no local',
      contactInfo: 'contato@clinica.com',
    })
    expect(prompt).toContain('Endereço: Rua Teste, 100')
    expect(prompt).toContain('Como chegar / estacionamento: Estacionamento no local')
    expect(prompt).toContain('Outros contatos: contato@clinica.com')
  })

  it('deve incluir as seções extras configuradas pelo consultório', () => {
    const prompt = build({
      pricingInfo: 'Retorno em 30 dias é gratuito.',
      examPreparation: 'Jejum de 8h.',
      policies: 'Tolerância de 15 minutos.',
      toneOfVoice: 'Bem informal.',
      forbiddenActions: 'Nunca falar de cirurgia por telefone.',
      handoffInstructions: 'Transferir sempre que falarem de convênio novo.',
    })
    expect(prompt).toContain('Retorno em 30 dias é gratuito.')
    expect(prompt).toContain('Jejum de 8h.')
    expect(prompt).toContain('Tolerância de 15 minutos.')
    expect(prompt).toContain('Bem informal.')
    expect(prompt).toContain('Nunca falar de cirurgia por telefone.')
    expect(prompt).toContain('Transferir sempre que falarem de convênio novo.')
  })

  it('deve incluir o FAQ configurado no formato pergunta/resposta', () => {
    const prompt = build({ faq: [{ question: 'Aceita Unimed?', answer: 'Sim.' }] })
    expect(prompt).toContain('P: Aceita Unimed?')
    expect(prompt).toContain('R: Sim.')
  })

  it('deve manter as regras clínicas absolutas em qualquer configuração', () => {
    const prompt = build()
    expect(prompt).toContain('NUNCA diagnostique')
    expect(prompt).toContain('Para questões clínicas, o médico vai avaliar pessoalmente durante a consulta.')
    expect(prompt).toContain('192')
  })

  it('deve documentar o formato exato dos marcadores lidos pelo sistema', () => {
    const prompt = build()
    expect(prompt).toContain('AGENDAMENTO_CONFIRMADO: AAAA-MM-DDTHH:mm-03:00')
    expect(prompt).toContain('CANCELAMENTO_CONFIRMADO: <id>')
    expect(prompt).toContain('NOME_PACIENTE: <nome completo exatamente como o paciente escreveu>')
  })

  it('deve usar a especialidade padrão quando ela não está configurada', () => {
    expect(build({ specialty: null })).toContain('Especialidade: Medicina Geral')
  })
})
