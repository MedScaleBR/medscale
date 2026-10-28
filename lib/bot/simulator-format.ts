import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import type { AgentEffect } from '@/lib/llm/agent-plan'
import { formatExternalRequestLines, INTAKE_FIELD_LABELS } from '@/lib/bot/unit-settings'
import type { IntakeField } from '@/types/database'

// Textos do simulador da Clara (/admin/clara/simulador). Puro: usado na tela e
// no "Copiar conversa".

const TZ = 'America/Sao_Paulo'

const FIELD_LABELS: Record<string, string> = {
  full_name: 'nome',
  birth_date: 'data de nascimento',
  cpf: 'CPF',
  email: 'e-mail',
  insurance_card_number: 'carteirinha',
  nome: 'nome',
  nascimento: 'data de nascimento',
  convenio: 'convênio',
}

const REASON_LABELS: Record<string, string> = {
  user_request: 'paciente pediu atendimento humano',
  bot_uncertain: 'a Clara pediu ajuda ([HANDOFF])',
  injection_suspected: 'suspeita de prompt injection',
  external_scheduling: 'agenda externa',
  out_of_hours: 'fora do horário',
}

function fieldLabel(field: string): string {
  return INTAKE_FIELD_LABELS[field as IntakeField]?.toLowerCase() ?? FIELD_LABELS[field] ?? field
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`
}

export function formatSimDateTime(iso: string): string {
  const d = new TZDate(new Date(iso), TZ)
  return `${format(d, 'dd/MM')} às ${format(d, 'HH:mm')}`
}

function formatBirth(iso: string): string {
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

/** Uma linha em português para cada efeito do plano. */
export function describeEffect(effect: AgentEffect): string {
  switch (effect.kind) {
    case 'save_patient_field':
      return `Salvaria ${fieldLabel(effect.field)} do paciente: ${effect.field === 'birth_date' ? formatBirth(effect.value) : effect.value}`
    case 'set_conversation_unit':
      return 'Ligaria a conversa à unidade indicada pelo paciente'
    case 'book': {
      const extras = [
        effect.insurer ? `convênio ${effect.insurer.name}` : 'particular',
        effect.procedure ? effect.procedure.name : null,
        effect.reason ? `motivo: ${effect.reason}` : null,
      ].filter(Boolean)
      return `Agendaria ${formatSimDateTime(effect.start)} em ${effect.unit_name} (${extras.join(' · ')}). Antes de gravar, a produção confere de novo se o horário está livre.`
    }
    case 'outsourced_request':
      return `Pediria à clínica parceira o horário de ${formatSimDateTime(effect.start)} em ${effect.unit_name}`
    case 'cancel':
      return effect.after_outsourced_request
        ? 'Cancelaria a consulta antiga, se o pedido à clínica parceira sair'
        : 'Cancelaria a consulta indicada pela Clara'
    case 'waitlist':
      return `Colocaria o paciente na lista de espera de ${effect.unit_name} para ${formatBirth(effect.date)}${effect.time ? ` às ${effect.time}` : ''}`
    case 'handoff':
      return effect.summary
        ? `Transferiria para a equipe (agenda externa) com este resumo:\n${formatExternalRequestLines(effect.summary, effect.unit_name).join('\n')}`
        : `Transferiria para a equipe de ${effect.unit_name} (${REASON_LABELS[effect.reason] ?? effect.reason}) e pausaria a Clara`
    case 'pending_request':
      return `Fora do horário de atendimento humano: deixaria a solicitação pendente no painel, avisaria a equipe e a Clara continuaria respondendo. Resumo:\n${formatExternalRequestLines(effect.summary, effect.unit_name).join('\n')}`
    case 'handoff_unavailable':
      return `Pedido de humano (${REASON_LABELS[effect.reason] ?? effect.reason}) fora do horário de atendimento: a Clara segue sozinha e manda a mensagem de fora do horário`
    case 'loop_breaker':
      return `Resposta repetida: o disjuntor transferiria para a equipe de ${effect.unit_name}`
    case 'blocked':
      switch (effect.reason) {
        case 'missing_fields':
        case 'outsourced_missing_data':
          return `Bloqueado: falta ${joinPt((effect.fields ?? []).map(fieldLabel))}`
        case 'insurance_unclear':
          return 'Bloqueado: convênio não confirmado (a Clara pede o convênio antes de agendar)'
        case 'unit_required':
          return 'Bloqueado: horário confirmado sem unidade (a Clara pergunta a unidade)'
        case 'discount_not_configured':
          return 'Bloqueado: a resposta prometia um desconto que não está configurado. A mensagem foi descartada'
      }
      return 'Bloqueado'
    case 'ignored_marker': {
      const why: Record<string, string> = {
        external_unit: 'em unidade de agenda externa',
        internal_unit: 'em unidade com agenda na MedScale',
        invalid_value: 'valor inválido',
        no_unit: 'sem unidade definida',
        module_disabled: 'módulo de lista de espera desligado',
      }
      return `Marcador ignorado: ${effect.marker} (${why[effect.reason] ?? effect.reason})`
    }
    case 'security_signal':
      return effect.triggers_handoff
        ? `Segurança: ${effect.patterns.length} sinais de prompt injection (${effect.patterns.join(', ')}). Isso dispara o handoff`
        : `Segurança: sinal de prompt injection (${effect.patterns.join(', ')}). Um sinal só não transfere; dois ou mais, sim`
  }
}

export interface SimTranscriptTurn {
  role: 'patient' | 'clara'
  text: string
  effects?: string[]
}

/** Texto para colar num chamado: mensagens + plano de efeitos de cada resposta. */
export function formatSimulationTranscript(input: {
  accountName: string
  simulatedNow: string | null
  turns: SimTranscriptTurn[]
}): string {
  const lines = [
    `Simulação da Clara — ${input.accountName}`,
    `Data simulada: ${input.simulatedNow ? formatSimDateTime(input.simulatedNow) : 'agora'}`,
    '',
  ]
  for (const turn of input.turns) {
    lines.push(`${turn.role === 'patient' ? 'Paciente' : 'Clara'}: ${turn.text}`)
    if (turn.effects?.length) {
      for (const e of turn.effects) lines.push(`  → ${e.replace(/\n/g, '\n    ')}`)
    }
  }
  return lines.join('\n')
}
