import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAccountUnits, type BotConfig, type UnitContext } from '@/lib/bot/config'
import { getFreeSlotsForBot } from '@/lib/google/availability'
import { detectInjectionAttempt, type InjectionSignal } from '@/lib/bot/security'
import type { IntakeField } from '@/lib/bot/unit-settings'
import type { Database } from '@/types/database'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'

// Etapa 1 do agente: montar o contexto de uma mensagem. Este arquivo só LÊ.
// A produção (lib/llm/agent.ts) cria paciente e conversa antes e passa o que
// leu; o simulador da Clara (/admin) passa paciente, conversa e histórico
// fictícios. Nada aqui grava no banco nem envia mensagem.

type SupabaseAdmin = SupabaseClient<Database>

export interface AgentPatient {
  id: string
  full_name: string | null
  birth_date: string | null
  /** false no simulador: o paciente não existe no banco e nada é consultado por ele. */
  persisted: boolean
}

/** Dados da coleta já guardados no paciente (patients.cpf/email/carteirinha). */
export interface StoredIntake {
  cpf: string | null
  email: string | null
  insurance_card_number: string | null
}

export interface AgentConversation {
  /** null no simulador. */
  id: string | null
  workspace_id: string | null
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  sent_at: string | null
}

export interface AgentContext {
  accountId: string
  accountName: string
  botConfig: BotConfig
  units: UnitContext[]
  unitById: Map<string, UnitContext>
  multiUnit: boolean
  /** Dados que alguma unidade coleta (vazio = account no padrão). */
  collectedFieldsAnywhere: Set<IntakeField>
  waitlistEnabled: boolean
  patientPhone: string
  patient: AgentPatient | null
  storedIntake: StoredIntake | null
  conversation: AgentConversation
  /** Unidade que o paciente já indicou (dica, não trava). */
  currentUnitId: string | null
  /** Texto da mensagem que o paciente acabou de mandar. */
  message: string
  history: HistoryMessage[]
  isFirstMessage: boolean
  now: Date
  freeSlotsByUnit: Record<string, Record<string, string[]>>
  upcomingAppointments: { id: string; label: string }[]
  upcomingAppointmentsAvailable: boolean
  procedureCatalogByUnit: Record<string, { id: string; name: string; price: number }[]>
  flatCatalog: { id: string; name: string; price: number }[]
  insurers: { id: string; name: string }[]
  insurersError: boolean
  injectionSignals: InjectionSignal[]
  /** Há número e token do WhatsApp — sem isso a produção não envia nem transfere. */
  channelReady: boolean
}

export interface AccountUnits {
  units: UnitContext[]
  accountName: string
  waitlistEnabled: boolean
}

export function isExternalUnit(ctx: Pick<AgentContext, 'unitById'>, unitId: string | null | undefined): boolean {
  return !!unitId && ctx.unitById.get(unitId)?.botSettings?.schedulingMode === 'external'
}

/** Unidades da account + nome e módulos. Mesma leitura na produção e no simulador. */
export async function loadAccountUnits(supabase: SupabaseAdmin, accountId: string): Promise<AccountUnits> {
  const [units, { data: account }] = await Promise.all([
    getAccountUnits(accountId),
    supabase.from('accounts').select('name, modules').eq('id', accountId).single(),
  ])
  const accountModules = (account as { modules?: unknown })?.modules
  return {
    units,
    accountName: account?.name ?? 'nossa clínica',
    waitlistEnabled: Array.isArray(accountModules) && accountModules.includes('waitlist'),
  }
}

// Slots livres de uma unidade nos próximos dias (até `maxDays` dias com vaga),
// contados a partir de `now` (o simulador pode passar outra data).
export async function collectFreeSlots(unitId: string, now: Date, maxDays = 4): Promise<Record<string, string[]>> {
  const byDay: Record<string, string[]> = {}
  for (let i = 1; i <= 12 && Object.keys(byDay).length < maxDays; i++) {
    const day = addDays(now, i)
    const slots = await getFreeSlotsForBot(unitId, day).catch(() => [])
    if (slots.length > 0) {
      byDay[format(new TZDate(day, 'America/Sao_Paulo'), 'yyyy-MM-dd')] = slots
    }
  }
  return byDay
}

/** Dados da coleta já salvos no paciente — só quando alguma unidade coleta algo. */
export async function loadStoredIntake(
  supabase: SupabaseAdmin,
  patient: AgentPatient | null,
  collected: ReadonlySet<IntakeField>
): Promise<StoredIntake | null> {
  if (collected.size === 0 || !patient?.persisted) return null
  const { data } = await supabase
    .from('patients')
    .select('cpf, email, insurance_card_number')
    .eq('id', patient.id)
    .maybeSingle()
  return data ?? null
}

export interface BuildAgentContextInput {
  supabase: SupabaseAdmin
  accountId: string
  botConfig: BotConfig
  account: AccountUnits
  patientPhone: string
  patient: AgentPatient | null
  storedIntake: StoredIntake | null
  conversation: AgentConversation
  message: string
  /** Histórico em ordem cronológica, já incluindo a mensagem atual. */
  history: HistoryMessage[]
  now: Date
  channelReady: boolean
}

export async function buildAgentContext(input: BuildAgentContextInput): Promise<AgentContext> {
  const { supabase, accountId, botConfig, account, patient, conversation, now } = input
  const units = account.units
  const unitById = new Map(units.map((u) => [u.id, u]))
  const multiUnit = units.length > 1
  const collectedFieldsAnywhere = new Set(units.flatMap((u) => u.botSettings?.intakeFields ?? []))
  const base = { unitById }

  const currentUnitId =
    conversation.workspace_id && unitById.has(conversation.workspace_id) ? conversation.workspace_id : null

  const history = input.history
  const isFirstMessage = history.length <= 1

  // Horários livres reais por unidade (availability_rules + Google Calendar).
  // Unidade com agenda externa não tem horários na MedScale.
  const slotsPerUnit = await Promise.all(
    units.map((u) => (isExternalUnit(base, u.id) ? Promise.resolve({}) : collectFreeSlots(u.id, now)))
  )
  const freeSlotsByUnit: Record<string, Record<string, string[]>> = {}
  units.forEach((u, i) => {
    freeSlotsByUnit[u.id] = slotsPerUnit[i]
  })

  // Consultas futuras já agendadas deste paciente — todas as unidades. O
  // paciente do simulador não existe no banco: não tem consultas.
  const { data: upcomingRows, error: upcomingError } = patient?.persisted
    ? await supabase
        .from('appointments')
        .select('id, scheduled_at, workspace_id, status')
        .eq('account_id', accountId)
        .eq('patient_id', patient.id)
        .in('status', ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS])
        .gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5)
    : { data: null, error: null }

  const upcomingAppointments = (upcomingRows ?? []).map((row) => {
    const zoned = new TZDate(new Date(row.scheduled_at), 'America/Sao_Paulo')
    const dateLabel = zoned.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const timeLabel = format(zoned, 'HH:mm')
    const unitName = row.workspace_id ? unitById.get(row.workspace_id)?.name : null
    if (row.status === PENDING_EXTERNAL_STATUS) {
      return { id: row.id, label: `${dateLabel} às ${timeLabel} — ${unitName ?? 'unidade'} — AGUARDANDO CONFIRMAÇÃO DA CLÍNICA` }
    }
    return {
      id: row.id,
      label: `${dateLabel} às ${timeLabel}${multiUnit && unitName ? ` — ${unitName}` : ''} — status: ${row.status === 'confirmado' ? 'confirmada' : 'agendada'}`,
    }
  })

  // Catálogo de procedimentos por unidade (ciclo de receita).
  const { data: catalogRows } = await supabase
    .from('procedure_catalog')
    .select('id, name, default_price, workspace_id')
    .in('workspace_id', units.map((u) => u.id))
    .eq('is_active', true)
    .order('name', { ascending: true })
  const procedureCatalogByUnit: Record<string, { id: string; name: string; price: number }[]> = {}
  for (const p of catalogRows ?? []) {
    ;(procedureCatalogByUnit[p.workspace_id] ??= []).push({
      id: p.id,
      name: p.name,
      price: Number(p.default_price),
    })
  }
  const flatCatalog = Object.values(procedureCatalogByUnit).flat()

  // Convênios aceitos — os ativos cadastrados em Convênios.
  const { data: insurerRows, error: insurersError } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  // Sinais de injection nas últimas 10 mensagens do paciente.
  const injectionSignals = history
    .filter((m) => m.role === 'user')
    .slice(-10)
    .map((m) => detectInjectionAttempt(m.content))
    .filter((s): s is InjectionSignal => s !== null)

  // LGPD: só não-PII no log. O texto bruto fica em `messages`, sob RLS.
  if (injectionSignals.length > 0) {
    console.warn(
      `[security] sinais=${injectionSignals.length} padrões=${injectionSignals.map((s) => s.pattern).join(',')} ` +
        `conversation=${conversation.id ?? 'simulador'}`
    )
  }

  return {
    accountId,
    accountName: account.accountName,
    botConfig,
    units,
    unitById,
    multiUnit,
    collectedFieldsAnywhere,
    waitlistEnabled: account.waitlistEnabled,
    patientPhone: input.patientPhone,
    patient,
    storedIntake: input.storedIntake,
    conversation: { ...conversation },
    currentUnitId,
    message: input.message,
    history,
    isFirstMessage,
    now,
    freeSlotsByUnit,
    upcomingAppointments,
    upcomingAppointmentsAvailable: !upcomingError,
    procedureCatalogByUnit,
    flatCatalog,
    insurers: insurerRows ?? [],
    insurersError: Boolean(insurersError),
    injectionSignals,
    channelReady: input.channelReady,
  }
}
