// Configuração da Clara por unidade (workspace): modo de agenda, dados que ela
// coleta e instruções próprias. Arquivo puro — usado pelo prompt-builder, pelo
// agente, pela rota de /admin e pelos componentes de tela.
import type { ExternalRequestSummary, IntakeField, SchedulingMode } from '@/types/database'
import { detectInjectionAttempt } from './security'
import type { UnitCoverage } from './unit-insurance'

export type { IntakeField, SchedulingMode }

export const SCHEDULING_MODES: readonly SchedulingMode[] = ['internal', 'external']

// Ordem canônica: é a ordem em que a Clara pede e em que a tela mostra.
export const INTAKE_FIELDS: readonly IntakeField[] = [
  'full_name',
  'birth_date',
  'insurance',
  'cpf',
  'email',
  'reason',
  'preference',
]

/** Rótulos das checkboxes em /admin e do resumo em /locais. */
export const INTAKE_FIELD_LABELS: Record<IntakeField, string> = {
  full_name: 'Nome completo',
  birth_date: 'Data de nascimento',
  insurance: 'Convênio (ou particular) e número da carteirinha',
  cpf: 'CPF',
  email: 'E-mail',
  reason: 'Motivo da consulta',
  preference: 'Dia ou período de preferência',
}

/** Descrição de cada dado no prompt da Clara. */
export const INTAKE_FIELD_PROMPT: Record<IntakeField, string> = {
  full_name: 'nome completo',
  birth_date: 'data de nascimento',
  insurance: 'convênio ou particular e, se for convênio, o número da carteirinha',
  cpf: 'CPF',
  email: 'e-mail',
  reason: 'motivo da consulta, em poucas palavras',
  preference: 'dia ou período de preferência',
}

/**
 * Como pedir um dado à unidade. Só o convênio muda: a unidade que não atende
 * particular não pode oferecer particular, e a que só atende particular não
 * pergunta convênio. Sem cobertura conhecida, vale o texto padrão.
 */
export function intakeFieldPrompt(field: IntakeField, coverage?: Pick<UnitCoverage, 'acceptsPrivate' | 'insurers'>): string {
  if (field !== 'insurance' || !coverage) return INTAKE_FIELD_PROMPT[field]
  if (!coverage.acceptsPrivate) return 'convênio e o número da carteirinha (esta unidade não atende particular)'
  if (coverage.insurers.length === 0) return 'confirmação de que o atendimento será particular (esta unidade não atende convênio)'
  return INTAKE_FIELD_PROMPT[field]
}

/** Mínimo de uma unidade 'external': sem isto a equipe não consegue marcar. */
export const EXTERNAL_REQUIRED_FIELDS: readonly IntakeField[] = ['full_name', 'insurance']
/** Pré-marcados ao trocar uma unidade para 'external'. */
export const EXTERNAL_DEFAULT_FIELDS: readonly IntakeField[] = ['full_name', 'birth_date', 'insurance', 'preference']

export const BOT_INSTRUCTIONS_MAX = 1000

export const SCHEDULING_MODE_LABELS: Record<SchedulingMode, string> = {
  internal: 'A Clara agenda direto (agenda na MedScale)',
  external: 'A Clara coleta os dados e a equipe confirma (agenda em sistema da clínica)',
}

/** Texto curto para o resumo somente leitura de /locais. */
export const SCHEDULING_MODE_SUMMARY: Record<SchedulingMode, string> = {
  internal: 'A Clara agenda direto',
  external: 'A Clara coleta os dados e a equipe confirma',
}

export interface WorkspaceBotSettings {
  schedulingMode: SchedulingMode
  intakeFields: IntakeField[]
  botInstructions: string | null
}

export const DEFAULT_BOT_SETTINGS: WorkspaceBotSettings = {
  schedulingMode: 'internal',
  intakeFields: [],
  botInstructions: null,
}

function isIntakeField(v: unknown): v is IntakeField {
  return typeof v === 'string' && (INTAKE_FIELDS as readonly string[]).includes(v)
}

/**
 * Ordena, remove duplicados e garante os mínimos do modo. 'preference' só faz
 * sentido em 'external' (em 'internal' o paciente escolhe um horário real),
 * então sai da lista de uma unidade 'internal'.
 */
export function normalizeIntakeFields(mode: SchedulingMode, fields: readonly unknown[]): IntakeField[] {
  const set = new Set(fields.filter(isIntakeField))
  if (mode === 'external') EXTERNAL_REQUIRED_FIELDS.forEach((f) => set.add(f))
  else set.delete('preference')
  return INTAKE_FIELDS.filter((f) => set.has(f))
}

/** Configuração de uma workspace com os padrões aplicados (colunas ausentes = padrão). */
export function getWorkspaceBotSettings(ws: {
  scheduling_mode?: string | null
  intake_fields?: readonly string[] | null
  bot_instructions?: string | null
}): WorkspaceBotSettings {
  const schedulingMode: SchedulingMode = ws.scheduling_mode === 'external' ? 'external' : 'internal'
  const instructions = ws.bot_instructions?.trim()
  return {
    schedulingMode,
    intakeFields: normalizeIntakeFields(schedulingMode, ws.intake_fields ?? []),
    botInstructions: instructions ? instructions : null,
  }
}

export const BOT_INSTRUCTIONS_INJECTION_ERROR =
  'As instruções parecem tentar mudar as regras da Clara. Reescreva como uma orientação simples sobre a unidade.'

/**
 * Valida as instruções da unidade. Devolve o motivo da recusa, ou null.
 * Os delimitadores <<< >>> são os do bloco no prompt — não podem aparecer no texto.
 */
export function botInstructionsProblem(text: string): string | null {
  if (text.length > BOT_INSTRUCTIONS_MAX) return `As instruções podem ter no máximo ${BOT_INSTRUCTIONS_MAX} caracteres.`
  if (text.includes('<<<') || text.includes('>>>')) return 'As instruções não podem conter "<<<" nem ">>>".'
  if (detectInjectionAttempt(text)) return BOT_INSTRUCTIONS_INJECTION_ERROR
  return null
}

export interface BotSettingsUpdate {
  scheduling_mode: SchedulingMode
  intake_fields: IntakeField[]
  bot_instructions: string | null
}

/** Valida o corpo do PATCH de /admin. Os mínimos de 'external' entram sozinhos. */
export function parseBotSettingsBody(
  body: unknown
): { ok: true; value: BotSettingsUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Corpo inválido.' }
  const b = body as Record<string, unknown>

  if (!SCHEDULING_MODES.includes(b.scheduling_mode as SchedulingMode)) {
    return { ok: false, error: 'Modo de agenda inválido.' }
  }
  const mode = b.scheduling_mode as SchedulingMode

  if (!Array.isArray(b.intake_fields)) return { ok: false, error: 'Lista de dados a coletar inválida.' }
  const unknown = b.intake_fields.filter((f) => !isIntakeField(f))
  if (unknown.length > 0) return { ok: false, error: 'Há dados a coletar desconhecidos na lista.' }

  let instructions: string | null = null
  if (b.bot_instructions !== undefined && b.bot_instructions !== null) {
    if (typeof b.bot_instructions !== 'string') return { ok: false, error: 'Instruções inválidas.' }
    const trimmed = b.bot_instructions.trim()
    if (trimmed) {
      const problem = botInstructionsProblem(trimmed)
      if (problem) return { ok: false, error: problem }
      instructions = trimmed
    }
  }

  return {
    ok: true,
    value: {
      scheduling_mode: mode,
      intake_fields: normalizeIntakeFields(mode, b.intake_fields),
      bot_instructions: instructions,
    },
  }
}

// ── Coleta: o que falta antes de agendar/transferir ─────────────────────────

export interface IntakeData {
  fullName: string | null
  birthDate: string | null
  /** Convênio resolvido: operadora válida ou particular aceito. */
  insuranceResolved: boolean
  particular: boolean
  cardNumber: string | null
  cpf: string | null
  email: string | null
  reason: string | null
  preference: string | null
}

/** Campos de `fields` ainda sem valor, na ordem canônica. "Paciente" não é nome. */
export function missingIntakeFields(fields: readonly IntakeField[], d: IntakeData): IntakeField[] {
  const has: Record<IntakeField, boolean> = {
    full_name: !!d.fullName?.trim() && d.fullName.trim() !== 'Paciente',
    birth_date: !!d.birthDate,
    insurance: d.insuranceResolved && (d.particular || !!d.cardNumber?.trim()),
    cpf: !!d.cpf,
    email: !!d.email,
    reason: !!d.reason?.trim(),
    preference: !!d.preference?.trim(),
  }
  return INTAKE_FIELDS.filter((f) => fields.includes(f) && !has[f])
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`
}

/** Mensagem fixa enviada quando o backend recusa por falta de dado. */
export function intakeMissingMessage(
  missing: readonly IntakeField[],
  coverage?: Pick<UnitCoverage, 'acceptsPrivate' | 'insurers'>
): string {
  return `Antes de seguir, só preciso de mais um detalhe: ${joinPt(missing.map((f) => intakeFieldPrompt(f, coverage)))}. Pode me passar?`
}

// ── Mensagens fixas da agenda externa (o texto do Claude é descartado) ──────

/** trigger_reason do handoff da solicitação de agendamento. */
export const EXTERNAL_REQUEST_REASON = 'external_scheduling' as const

/** AGENDAMENTO_CONFIRMADO numa unidade 'external': nada foi marcado. */
export const EXTERNAL_BOOKING_BLOCKED_MESSAGE =
  'Nesta unidade quem confirma o horário é a equipe, pela agenda da própria clínica. Posso anotar seus dados para eles confirmarem com você por aqui?'

export function externalRequestInHoursMessage(unitName: string): string {
  return `Prontinho, anotei tudo. Vou passar para a equipe conferir a agenda da ${unitName} e confirmar o horário com você por aqui.`
}

export function externalRequestOutOfHoursMessage(unitName: string): string {
  return `Prontinho, anotei tudo. A equipe confere a agenda da ${unitName} e confirma o horário com você por aqui no próximo horário de atendimento. Enquanto isso, se tiver alguma dúvida, é só me chamar.`
}

// ── Resumo da solicitação (painel /bot e push) ──────────────────────────────

function formatBirth(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatCpf(digits: string): string {
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

/** Linhas do resumo, só com o que a unidade coletou. Telefone e local sempre. */
export function formatExternalRequestLines(summary: ExternalRequestSummary, unitName: string): string[] {
  const lines: string[] = []
  if (summary.full_name) lines.push(`Paciente: ${summary.full_name}`)
  if (summary.birth_date) lines.push(`Nascimento: ${formatBirth(summary.birth_date)}`)
  lines.push(`Telefone: ${summary.phone}`)
  if (summary.particular) lines.push('Convênio: Particular')
  else if (summary.insurance) {
    lines.push(
      `Convênio: ${summary.insurance.name}${summary.insurance.card_number ? ` · Carteirinha: ${summary.insurance.card_number}` : ''}`
    )
  }
  if (summary.cpf) lines.push(`CPF: ${formatCpf(summary.cpf)}`)
  if (summary.email) lines.push(`E-mail: ${summary.email}`)
  lines.push(`Local: ${unitName}`)
  if (summary.reason) lines.push(`Motivo: ${summary.reason}`)
  if (summary.preference) lines.push(`Preferência: ${summary.preference}`)
  return lines
}

export function formatExternalRequestSummary(summary: ExternalRequestSummary, unitName: string): string {
  return ['Solicitação de agendamento', ...formatExternalRequestLines(summary, unitName)].join('\n')
}
