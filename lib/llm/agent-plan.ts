import { isHandoffAvailableNow as realIsHandoffAvailableNow, detectHandoffIntent } from '@/lib/bot/handoff-rules'
import { parseMarkers, type ParsedMarkers } from '@/lib/bot/parse-markers'
import {
  containsUnconfiguredDiscount,
  parseBirthDate,
  parseCardNumber,
  parseCpf,
  parseEmail,
  parseIsoBirthDate,
  sanitizePatientName,
  sanitizeShortText,
} from '@/lib/bot/security'
import {
  EXTERNAL_BOOKING_BLOCKED_MESSAGE,
  EXTERNAL_REQUEST_REASON,
  externalRequestInHoursMessage,
  externalRequestOutOfHoursMessage,
  intakeMissingMessage,
  missingIntakeFields,
  type IntakeField,
} from '@/lib/bot/unit-settings'
import { missingOutsourcedFields, type OutsourcedMissingField } from '@/lib/outsourced/config'
import { missingDataMessage, requestedMessage } from '@/lib/outsourced/messages'
import { coverageFor, isExternalUnit, type AgentContext, type AgentPatient } from '@/lib/llm/agent-context'
import type { ExternalRequestSummary, HandoffTriggerReason } from '@/types/database'
import { attendsOn, closedDayMessage } from '@/lib/bot/working-days'

// Etapa 3 do agente: ler a resposta crua do Claude, validar os marcadores e
// decidir O QUE aconteceria — sem fazer nada. A produção executa o plano em
// applyEffects (lib/llm/agent.ts); o simulador da Clara só mostra.
//
// Este arquivo não importa nada que grave no banco, envie WhatsApp, mexa no
// Google Calendar ou mande push. A única leitura é o horário de atendimento
// humano (isHandoffAvailableNow), que o simulador chama com a data simulada.

// Mensagens fixas usadas quando o agendamento/cancelamento que a IA anunciou
// não bate no banco — comparadas literalmente contra a última mensagem do
// bot pra detectar quando a mesma falha se repete (disjuntor de loop).
export const BOOKING_FAILED_MESSAGE =
  'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro horário entre os que te passei, por favor?'
export const UNIT_REQUIRED_MESSAGE =
  'Só preciso confirmar: em qual unidade você prefere ser atendido?'
export const CANCELLATION_FAILED_MESSAGE =
  'Não encontrei essa consulta no sistema para cancelar agora. Pode confirmar comigo a data e o horário certos? Se preferir, chamo alguém da equipe para te ajudar.'

const MAX_INTAKE_TEXT = 200

/**
 * A escolha de pagamento não vale na unidade: diz o motivo e o que dá para
 * fazer — outra unidade que aceita o convênio, particular, ou outro convênio.
 */
function insuranceNotAcceptedMessage(
  ctx: Pick<AgentContext, 'coverageByUnit' | 'units' | 'unitById'>,
  unitId: string,
  insurer: { id: string; name: string } | null
): string {
  const unitName = ctx.unitById.get(unitId)?.name ?? 'esta unidade'
  const coverage = coverageFor(ctx, unitId)
  if (!insurer) {
    return coverage.insurers.length > 0
      ? `A unidade ${unitName} não atende particular. Pode me dizer qual é o seu convênio? Lá aceitamos ${coverage.insurers.map((i) => i.name).join(', ')}.`
      : `A unidade ${unitName} não atende particular. Quer que eu chame alguém da equipe para te ajudar?`
  }
  const otherUnits = ctx.units
    .filter((u) => u.id !== unitId && coverageFor(ctx, u.id).insurers.some((i) => i.id === insurer.id))
    .map((u) => u.name)
  const options = [
    otherUnits.length > 0 ? `marcar na unidade ${otherUnits.join(' ou ')}, que aceita ${insurer.name}` : null,
    coverage.acceptsPrivate ? `fazer a consulta particular na ${unitName}` : null,
  ].filter(Boolean)
  return options.length > 0
    ? `A unidade ${unitName} não atende pelo ${insurer.name}. Se preferir, dá para ${options.join(', ou ')}. Como prefere?`
    : `A unidade ${unitName} não atende pelo ${insurer.name}. Quer que eu chame alguém da equipe para te ajudar?`
}
const BOOKING_DURATION_MIN = 30

function saoPauloDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export type PatientField = 'full_name' | 'birth_date' | 'cpf' | 'email' | 'insurance_card_number'

type Procedure = { id: string; name: string; price: number }
type Insurer = { id: string; name: string }

export type BlockReason =
  | 'missing_fields'
  | 'insurance_unclear'
  | 'insurance_not_accepted'
  | 'unit_required'
  | 'outsourced_missing_data'
  | 'discount_not_configured'

export type IgnoreReason = 'external_unit' | 'internal_unit' | 'invalid_value' | 'no_unit' | 'module_disabled' | 'closed_day'

/** O que aconteceria com esta resposta. Os de "aviso" não executam nada. */
export type AgentEffect =
  | { kind: 'save_patient_field'; field: PatientField; value: string }
  | { kind: 'set_conversation_unit'; workspace_id: string }
  | {
      kind: 'book'
      workspace_id: string
      unit_name: string
      start: string
      duration_min: number
      procedure: Procedure | null
      insurer: Insurer | null
      reason: string | null
    }
  | {
      kind: 'outsourced_request'
      workspace_id: string
      unit_name: string
      external_clinic_phone: string
      start: string
      duration_min: number
      procedure: Procedure | null
      insurer: Insurer | null
      replacing_appointment_id: string | null
    }
  | { kind: 'cancel'; appointment_id: string; after_outsourced_request: boolean }
  | { kind: 'waitlist'; workspace_id: string; unit_name: string; date: string; time: string | null }
  | {
      kind: 'handoff'
      reason: HandoffTriggerReason
      workspace_id: string
      unit_name: string
      summary: ExternalRequestSummary | null
    }
  | { kind: 'pending_request'; workspace_id: string; unit_name: string; summary: ExternalRequestSummary }
  | { kind: 'handoff_unavailable'; workspace_id: string; unit_name: string; reason: HandoffTriggerReason }
  | { kind: 'loop_breaker'; workspace_id: string; unit_name: string }
  | { kind: 'blocked'; reason: BlockReason; fields?: string[]; workspace_id?: string }
  | { kind: 'ignored_marker'; marker: string; reason: IgnoreReason; workspace_id?: string }
  | { kind: 'security_signal'; patterns: string[]; triggers_handoff: boolean }

/** O que decide a mensagem final (ver resolveFinalMessage). */
export interface MessagePlan {
  /** Mensagem fixa decidida já no plano (unidade externa, convênio, unidade, dado faltando). */
  fixed: string | null
  /** Unidade terceirizada sem os dados obrigatórios. */
  outsourcedMissing: string | null
  discountFlagged: boolean
  messageForPatient: string
  externalRequest: { unitName: string; inHours: boolean } | null
  /** Handoff pedido fora do horário: a mensagem de fora do horário vai junto. */
  outOfHoursAppend: string | null
  realHandoff: boolean
  lastAssistantContent: string | undefined
}

/** Resultado do que só a execução sabe (revalidação do horário, pedido à clínica, cancelamento). */
export interface ApplyOutcome {
  bookingFailed: boolean
  outsourcedMessage: string | null
  cancellationFailed: boolean
}

export interface ExternalRequestPlan {
  unitId: string
  unitName: string
  summary: ExternalRequestSummary
  inHours: boolean
}

export interface AgentPlan {
  markers: ParsedMarkers
  raw: string
  discountFlagged: boolean
  /** Paciente depois dos dados desta resposta. */
  patient: AgentPatient | null
  /** Unidade da conversa depois do UNIDADE_ID desta resposta. */
  conversationUnitId: string | null
  effects: AgentEffect[]
  message: MessagePlan
  externalRequest: ExternalRequestPlan | null
  handoff: {
    unitId: string
    notifyWorkspaceIds: string[]
    reason: HandoffTriggerReason | null
    canAttempt: boolean
  }
  /** Mensagem do disjuntor de loop, caso a resposta final repita a anterior. */
  loopEscalationMessage: string
  /** Mensagem final prevista, supondo que os efeitos deem certo. */
  reply: string
  /** O que o paciente receberia pelo WhatsApp, em ordem (previsto). */
  outgoing: string[]
}

export interface PlanProbes {
  isHandoffAvailableNow: (workspaceId: string, accountId: string, at: Date) => Promise<boolean>
}

const DEFAULT_PROBES: PlanProbes = { isHandoffAvailableNow: realIsHandoffAvailableNow }

export function resolveFinalMessage(m: MessagePlan, outcome: ApplyOutcome): string {
  let message: string
  if (m.fixed !== null) message = m.fixed
  else if (outcome.bookingFailed) message = BOOKING_FAILED_MESSAGE
  else if (outcome.outsourcedMessage ?? m.outsourcedMissing) message = (outcome.outsourcedMessage ?? m.outsourcedMissing)!
  else if (outcome.cancellationFailed) message = CANCELLATION_FAILED_MESSAGE
  // Vazia de propósito: o paciente recebe só a mensagem genérica de transição
  // que o executeHandoff envia. Nada indica que houve detecção.
  else if (m.discountFlagged) message = ''
  else message = m.messageForPatient

  // Solicitação válida: mensagem fixa (o Claude não promete horário).
  if (m.externalRequest) {
    message = m.externalRequest.inHours
      ? externalRequestInHoursMessage(m.externalRequest.unitName)
      : externalRequestOutOfHoursMessage(m.externalRequest.unitName)
  }
  if (m.outOfHoursAppend) {
    message = message ? `${message}\n\n${m.outOfHoursAppend}` : m.outOfHoursAppend
  }
  return message
}

/** Disjuntor de loop — resposta idêntica à última do próprio bot. */
export function isLoopBreak(m: MessagePlan, finalMessage: string): boolean {
  return Boolean(finalMessage) && !m.realHandoff && !m.externalRequest && finalMessage === m.lastAssistantContent
}

export async function planEffects(
  ctx: AgentContext,
  raw: string,
  probes: PlanProbes = DEFAULT_PROBES
): Promise<AgentPlan> {
  const { botConfig, unitById, units, accountId } = ctx
  const conversationLabel = ctx.conversation.id ?? 'simulador'
  const effects: AgentEffect[] = []
  const singleUnitId = units.length === 1 ? units[0].id : null
  const unitName = (id: string) => unitById.get(id)?.name ?? 'unidade'
  const validMarkerUnit = (id: string | null) => (id && unitById.has(id) ? id : null)

  const markers = parseMarkers(raw)
  const cleanedMessage = markers.cleanedMessage

  // Fail-safe financeiro: a resposta que promete um desconto que não está
  // configurado em lugar nenhum não chega ao paciente. O processamento de
  // marcadores segue normal — um agendamento legítimo na mesma resposta é
  // criado do mesmo jeito. Esta camada nunca decide se uma consulta é legítima.
  const discountFlagged = containsUnconfiguredDiscount(raw, botConfig)
  if (discountFlagged) {
    console.warn(`[security] resposta com desconto não configurado descartada conversation=${conversationLabel}`)
    effects.push({ kind: 'blocked', reason: 'discount_not_configured' })
  }

  const patient: AgentPatient | null = ctx.patient ? { ...ctx.patient } : null

  // Nome rejeitado não atualiza o paciente e não falha o fluxo. O log leva só
  // o tamanho, nunca o valor (LGPD).
  const patientName = markers.patientName ? sanitizePatientName(markers.patientName) : null
  if (markers.patientName && !patientName) {
    console.warn(`[security] NOME_PACIENTE rejeitado conversation=${conversationLabel} tamanho=${markers.patientName.length}`)
    effects.push({ kind: 'ignored_marker', marker: 'NOME_PACIENTE', reason: 'invalid_value' })
  }
  if (patient && patientName && patientName !== patient.full_name) {
    effects.push({ kind: 'save_patient_field', field: 'full_name', value: patientName })
    patient.full_name = patientName
  }

  // Nascimento: DATA_NASCIMENTO (AAAA-MM-DD) é o formato da coleta por unidade;
  // NASCIMENTO_PACIENTE (DD/MM/AAAA) segue valendo para as terceirizadas.
  // Data inválida é descartada; o log leva só o id da conversa.
  const birthDate =
    (markers.patientBirthDate ? parseBirthDate(markers.patientBirthDate, ctx.now) : null) ??
    (markers.isoBirthDate ? parseIsoBirthDate(markers.isoBirthDate, ctx.now) : null)
  if ((markers.patientBirthDate || markers.isoBirthDate) && !birthDate) {
    console.warn(`[security] data de nascimento rejeitada conversation=${conversationLabel}`)
    effects.push({
      kind: 'ignored_marker',
      marker: markers.isoBirthDate ? 'DATA_NASCIMENTO' : 'NASCIMENTO_PACIENTE',
      reason: 'invalid_value',
    })
  }
  if (patient && birthDate && birthDate !== patient.birth_date) {
    effects.push({ kind: 'save_patient_field', field: 'birth_date', value: birthDate })
    patient.birth_date = birthDate
  }

  // Dados da coleta por unidade (workspaces.intake_fields). Só guarda o que
  // alguma unidade da account pede — CPF nunca é guardado sem unidade com 'cpf'.
  // Motivo e preferência valem só para esta resposta.
  const intake = { cardNumber: null as string | null, cpf: null as string | null, email: null as string | null, reason: null as string | null, preference: null as string | null }
  if (ctx.collectedFieldsAnywhere.size > 0 && patient) {
    const parse = (field: IntakeField, marker: string, rawValue: string | null, fn: (v: string) => string | null) => {
      if (!ctx.collectedFieldsAnywhere.has(field) || !rawValue) return null
      const value = fn(rawValue)
      if (!value) {
        console.warn(`[intake] valor rejeitado field=${field} conversation=${conversationLabel}`)
        effects.push({ kind: 'ignored_marker', marker, reason: 'invalid_value' })
      }
      return value
    }
    const card = parse('insurance', 'CARTEIRINHA', markers.cardNumber, parseCardNumber)
    const cpf = parse('cpf', 'CPF', markers.cpf, parseCpf)
    const email = parse('email', 'EMAIL', markers.email, parseEmail)
    const reason = parse('reason', 'MOTIVO_CONSULTA', markers.reason, (v) => sanitizeShortText(v, MAX_INTAKE_TEXT))
    const preference = parse('preference', 'PREFERENCIA_HORARIO', markers.preference, (v) => sanitizeShortText(v, MAX_INTAKE_TEXT))

    const stored = ctx.storedIntake
    if (card && card !== stored?.insurance_card_number) effects.push({ kind: 'save_patient_field', field: 'insurance_card_number', value: card })
    if (cpf && cpf !== stored?.cpf) effects.push({ kind: 'save_patient_field', field: 'cpf', value: cpf })
    if (email && email !== stored?.email) effects.push({ kind: 'save_patient_field', field: 'email', value: email })

    intake.cardNumber = card ?? stored?.insurance_card_number ?? null
    intake.cpf = cpf ?? stored?.cpf ?? null
    intake.email = email ?? stored?.email ?? null
    intake.reason = reason
    intake.preference = preference
  }

  // Unidade corrente: a Clara emite UNIDADE_ID quando o paciente indica a
  // unidade. Vai para a conversa e serve de dica nas próximas mensagens.
  let conversationUnitId = ctx.conversation.workspace_id
  if (markers.unitId && unitById.has(markers.unitId) && conversationUnitId !== markers.unitId) {
    effects.push({ kind: 'set_conversation_unit', workspace_id: markers.unitId })
    conversationUnitId = markers.unitId
  }

  // Para quem vai a notificação de handoff: a unidade conhecida, ou todas.
  const handoffNotifyIds = conversationUnitId ? [conversationUnitId] : units.map((u) => u.id)

  let unitRequired = false
  let outsourcedMissing: string | null = null
  let outsourcedPlanned: { start: Date; unitName: string } | null = null
  // Coleta por unidade: dados que faltam antes de agendar (unidade 'internal')
  // ou de transferir (unidade 'external'). null = nada recusado.
  let intakeMissing: IntakeField[] | null = null
  // Unidade do dado faltando — o texto do convênio depende do que ela aceita.
  let intakeMissingUnitId: string | null = null

  // A Clara nunca marca consulta em unidade com agenda externa: o prompt
  // proíbe e aqui o marcador é descartado.
  const requestedBookingUnitId = validMarkerUnit(markers.unitId) ?? ctx.currentUnitId ?? singleUnitId
  const externalBookingBlocked = markers.confirmedDate !== null && isExternalUnit(ctx, requestedBookingUnitId)
  if (externalBookingBlocked) {
    console.warn(`[intake] AGENDAMENTO_CONFIRMADO ignorado em unidade externa workspace=${requestedBookingUnitId}`)
    effects.push({
      kind: 'ignored_marker',
      marker: 'AGENDAMENTO_CONFIRMADO',
      reason: 'external_unit',
      workspace_id: requestedBookingUnitId ?? undefined,
    })
  }
  // Dia em que a unidade não atende: não agenda nem pede à clínica parceira —
  // a Clara avisa os dias de atendimento (mensagem fixa abaixo).
  const bookingUnitForDays = requestedBookingUnitId ? unitById.get(requestedBookingUnitId) : undefined
  let closedDay: { unitName: string; days: number[] } | null = null
  if (
    !externalBookingBlocked &&
    markers.confirmedDate !== null &&
    bookingUnitForDays &&
    !attendsOn(bookingUnitForDays, saoPauloDate(markers.confirmedDate))
  ) {
    console.warn(`[working-days] AGENDAMENTO_CONFIRMADO em dia sem atendimento workspace=${bookingUnitForDays.id}`)
    effects.push({ kind: 'ignored_marker', marker: 'AGENDAMENTO_CONFIRMADO', reason: 'closed_day', workspace_id: bookingUnitForDays.id })
    closedDay = { unitName: bookingUnitForDays.name, days: bookingUnitForDays.workingDays! }
  }
  const confirmedDate = externalBookingBlocked || closedDay ? null : markers.confirmedDate

  const insuranceChoice = markers.insuranceChoice
  const selectedInsurer =
    insuranceChoice && insuranceChoice !== 'PARTICULAR'
      ? ctx.insurers.find((i) => i.id.toLowerCase() === insuranceChoice.toLowerCase()) ?? null
      : null
  // O que a unidade do agendamento aceita (particular e convênios ligados a ela).
  const bookingCoverage = coverageFor(ctx, requestedBookingUnitId)
  // Convênio válido, mas não aceito na unidade (ou particular onde não há particular).
  const insuranceNotAccepted =
    confirmedDate !== null &&
    !ctx.insurersError &&
    !!requestedBookingUnitId &&
    (selectedInsurer
      ? !bookingCoverage.insurers.some((i) => i.id === selectedInsurer.id)
      : insuranceChoice === 'PARTICULAR' && !bookingCoverage.acceptsPrivate)
  const insuranceNeedsClarification =
    confirmedDate !== null &&
    (ctx.insurersError ||
      insuranceNotAccepted ||
      (insuranceChoice === null
        ? bookingCoverage.insurers.length > 0 || !bookingCoverage.acceptsPrivate
        : insuranceChoice === 'PARTICULAR'
          ? !bookingCoverage.acceptsPrivate
          : !selectedInsurer))
  if (insuranceNotAccepted) {
    console.warn(`[insurance] escolha não aceita na unidade workspace=${requestedBookingUnitId}`)
    effects.push({ kind: 'blocked', reason: 'insurance_not_accepted', workspace_id: requestedBookingUnitId ?? undefined })
  } else if (insuranceNeedsClarification) {
    effects.push({ kind: 'blocked', reason: 'insurance_unclear' })
  }

  // Unidade envolvida nesta troca (agendamento, ou contexto atual da conversa).
  let resolvedUnitId: string | null = conversationUnitId ?? singleUnitId

  if (confirmedDate && !insuranceNeedsClarification) {
    const bookingUnitId = requestedBookingUnitId
    if (!bookingUnitId) {
      // A Clara confirmou um horário sem dizer a unidade (account com várias).
      unitRequired = true
      effects.push({ kind: 'blocked', reason: 'unit_required' })
    } else {
      resolvedUnitId = bookingUnitId
      const unitCatalog = ctx.procedureCatalogByUnit[bookingUnitId] ?? []
      const resolvedProcedure =
        !selectedInsurer && markers.procedureId
          ? unitCatalog.find((p) => p.id === markers.procedureId) ??
            ctx.flatCatalog.find((p) => p.id === markers.procedureId) ??
            null
          : null

      const bookingUnit = unitById.get(bookingUnitId)
      // Unidade 'internal' com dados a coletar: o backend confere antes de agendar.
      const bookingIntakeFields = bookingUnit?.botSettings?.intakeFields ?? []
      const bookingMissing =
        bookingIntakeFields.length > 0
          ? missingIntakeFields(bookingIntakeFields, {
              fullName: patient?.full_name ?? null,
              birthDate: patient?.birth_date ?? null,
              insuranceResolved: true, // chegar aqui já é convênio resolvido
              particular: !selectedInsurer,
              cardNumber: intake.cardNumber,
              cpf: intake.cpf,
              email: intake.email,
              reason: intake.reason,
              preference: null,
            })
          : []

      if (bookingMissing.length > 0) {
        console.warn(`[intake] missing_fields=${bookingMissing.join(',')} trigger_reason=booking workspace=${bookingUnitId}`)
        intakeMissing = bookingMissing
        intakeMissingUnitId = bookingUnitId
        effects.push({ kind: 'blocked', reason: 'missing_fields', fields: bookingMissing, workspace_id: bookingUnitId })
      } else if (bookingUnit?.isOutsourced && bookingUnit.externalClinicPhone) {
        // Unidade terceirizada: a Clara não agenda — pede o horário à clínica parceira.
        const missing: OutsourcedMissingField[] = missingOutsourcedFields({
          fullName: patient?.full_name ?? null,
          birthDate: patient?.birth_date ?? null,
          insuranceChosen: !insuranceNeedsClarification,
        })
        if (missing.length > 0 || !patient || !patient.full_name || !patient.birth_date) {
          outsourcedMissing = missingDataMessage(missing, bookingUnit.name)
          effects.push({ kind: 'blocked', reason: 'outsourced_missing_data', fields: missing, workspace_id: bookingUnitId })
        } else {
          outsourcedPlanned = { start: confirmedDate, unitName: bookingUnit.name }
          effects.push({
            kind: 'outsourced_request',
            workspace_id: bookingUnitId,
            unit_name: bookingUnit.name,
            external_clinic_phone: bookingUnit.externalClinicPhone,
            start: confirmedDate.toISOString(),
            duration_min: BOOKING_DURATION_MIN,
            procedure: resolvedProcedure,
            insurer: selectedInsurer,
            replacing_appointment_id: markers.cancelledAppointmentId,
          })
        }
      } else {
        effects.push({
          kind: 'book',
          workspace_id: bookingUnitId,
          unit_name: unitName(bookingUnitId),
          start: confirmedDate.toISOString(),
          duration_min: BOOKING_DURATION_MIN,
          procedure: resolvedProcedure,
          insurer: selectedInsurer,
          reason: intake.reason && bookingIntakeFields.includes('reason') ? intake.reason : null,
        })
      }
    }
  }

  // Cancelamento confirmado — casa por id + paciente. Remarcação que não
  // agendou (dado faltando, unidade externa) mantém a antiga. Se a remarcação
  // depende do pedido à clínica parceira, a execução só cancela se o pedido saiu.
  if (
    markers.cancelledAppointmentId &&
    patient &&
    !insuranceNeedsClarification &&
    outsourcedMissing === null &&
    !externalBookingBlocked &&
    closedDay === null &&
    intakeMissing === null
  ) {
    effects.push({
      kind: 'cancel',
      appointment_id: markers.cancelledAppointmentId,
      after_outsourced_request: outsourcedPlanned !== null,
    })
  }

  // Lista de espera — nunca junto de um agendamento confirmado; ignorada se o
  // módulo waitlist não estiver ativo na account.
  if (markers.waitlistDesired && !ctx.waitlistEnabled) {
    effects.push({ kind: 'ignored_marker', marker: 'LISTA_ESPERA', reason: 'module_disabled' })
  }
  if (markers.waitlistDesired && ctx.waitlistEnabled && !markers.confirmedDate && patient) {
    const waitlistUnitId = validMarkerUnit(markers.unitId) ?? ctx.currentUnitId ?? singleUnitId
    const waitlistUnit = waitlistUnitId ? unitById.get(waitlistUnitId) : undefined
    if (waitlistUnit && !attendsOn(waitlistUnit, markers.waitlistDesired.date)) {
      // A vaga nunca vai abrir: a unidade não atende nesse dia.
      console.warn(`[working-days] LISTA_ESPERA em dia sem atendimento workspace=${waitlistUnit.id}`)
      effects.push({ kind: 'ignored_marker', marker: 'LISTA_ESPERA', reason: 'closed_day', workspace_id: waitlistUnit.id })
      closedDay ??= { unitName: waitlistUnit.name, days: waitlistUnit.workingDays! }
    } else if (waitlistUnitId) {
      effects.push({
        kind: 'waitlist',
        workspace_id: waitlistUnitId,
        unit_name: unitName(waitlistUnitId),
        date: markers.waitlistDesired.date,
        time: markers.waitlistDesired.time,
      })
    }
  }

  // Solicitação de agendamento (unidade com agenda externa). Só vale numa
  // unidade 'external' e com todos os dados que ela coleta.
  let externalRequest: Omit<ExternalRequestPlan, 'inHours'> | null = null
  let externalRequestUnitRequired = false
  if (markers.schedulingRequested && !discountFlagged) {
    const requestUnitId = validMarkerUnit(markers.unitId) ?? conversationUnitId ?? singleUnitId
    const requestUnit = requestUnitId ? unitById.get(requestUnitId) : undefined

    if (!requestUnit) {
      console.warn(`[intake] SOLICITACAO_AGENDAMENTO sem unidade conversation=${conversationLabel}`)
      externalRequestUnitRequired = ctx.multiUnit
      effects.push({ kind: 'ignored_marker', marker: 'SOLICITACAO_AGENDAMENTO', reason: 'no_unit' })
    } else if (requestUnit.botSettings?.schedulingMode !== 'external') {
      console.warn(`[intake] SOLICITACAO_AGENDAMENTO ignorado em unidade internal workspace=${requestUnit.id}`)
      effects.push({ kind: 'ignored_marker', marker: 'SOLICITACAO_AGENDAMENTO', reason: 'internal_unit', workspace_id: requestUnit.id })
    } else {
      const fields = requestUnit.botSettings.intakeFields
      const requestCoverage = coverageFor(ctx, requestUnit.id)
      const particular =
        requestCoverage.acceptsPrivate &&
        (insuranceChoice === 'PARTICULAR' || (insuranceChoice === null && requestCoverage.insurers.length === 0))
      // Convênio que a unidade não aceita conta como não resolvido: a Clara pergunta de novo.
      const insurerAccepted = !!selectedInsurer && requestCoverage.insurers.some((i) => i.id === selectedInsurer.id)
      const missing = missingIntakeFields(fields, {
        fullName: patient?.full_name ?? null,
        birthDate: patient?.birth_date ?? null,
        insuranceResolved: !ctx.insurersError && (particular || insurerAccepted),
        particular,
        cardNumber: intake.cardNumber,
        cpf: intake.cpf,
        email: intake.email,
        reason: intake.reason,
        preference: intake.preference,
      })

      if (missing.length > 0) {
        console.warn(`[intake] missing_fields=${missing.join(',')} trigger_reason=${EXTERNAL_REQUEST_REASON} workspace=${requestUnit.id}`)
        intakeMissing = missing
        intakeMissingUnitId = requestUnit.id
        effects.push({ kind: 'blocked', reason: 'missing_fields', fields: missing, workspace_id: requestUnit.id })
      } else {
        const summary: ExternalRequestSummary = {
          workspace_id: requestUnit.id,
          phone: `+${ctx.patientPhone.replace(/\D/g, '')}`,
        }
        if (fields.includes('full_name')) summary.full_name = patient!.full_name!
        if (fields.includes('birth_date')) summary.birth_date = patient!.birth_date!
        if (fields.includes('insurance')) {
          summary.particular = particular
          if (!particular && selectedInsurer && insurerAccepted) {
            summary.insurance = { convenio_id: selectedInsurer.id, name: selectedInsurer.name, card_number: intake.cardNumber }
          }
        }
        if (fields.includes('cpf')) summary.cpf = intake.cpf!
        if (fields.includes('email')) summary.email = intake.email!
        if (fields.includes('reason')) summary.reason = intake.reason!
        if (fields.includes('preference')) summary.preference = intake.preference!
        externalRequest = { unitId: requestUnit.id, unitName: requestUnit.name, summary }
      }
    }
  }

  const lastAssistantContent = [...ctx.history].reverse().find((m) => m.role === 'assistant')?.content

  // Handoff — a unidade de contato/horário é a da conversa (ou a única).
  if (externalRequest) resolvedUnitId = externalRequest.unitId
  const handoffUnitId = resolvedUnitId ?? units[0].id
  const handoffUnit = unitById.get(handoffUnitId)
  // Desconto não lastreado força o handoff direto.
  const handoffCheck = discountFlagged
    ? { needed: true, reason: 'injection_suspected' as const }
    : detectHandoffIntent(cleanedMessage, ctx.message, ctx.injectionSignals.length)
  // A solicitação de agendamento tem handoff próprio, com resumo.
  const canAttemptHandoff = !externalRequest && handoffCheck.needed && ctx.channelReady

  if (ctx.injectionSignals.length > 0) {
    effects.push({
      kind: 'security_signal',
      patterns: ctx.injectionSignals.map((s) => s.pattern),
      triggers_handoff: handoffCheck.reason === 'injection_suspected',
    })
  }

  console.log(
    `[handoff] needed=${handoffCheck.needed} reason=${handoffCheck.reason ?? '-'} ` +
      `unit=${handoffUnitId} hasNumber=${Boolean(handoffUnit?.handoffNumber)} ` +
      `hasPhoneId=${Boolean(botConfig.phoneNumberId)} hasToken=${Boolean(botConfig.metaToken)} canAttempt=${Boolean(canAttemptHandoff)}`
  )

  const fixed = externalBookingBlocked
    ? EXTERNAL_BOOKING_BLOCKED_MESSAGE
    : closedDay
      ? closedDayMessage(closedDay.unitName, closedDay.days)
    : insuranceNotAccepted
      ? insuranceNotAcceptedMessage(ctx, requestedBookingUnitId!, selectedInsurer)
    : insuranceNeedsClarification
      ? bookingCoverage.acceptsPrivate
        ? 'Antes de confirmar o agendamento, pode confirmar qual é o seu convênio ou se prefere atendimento particular?'
        : 'Antes de confirmar o agendamento, pode confirmar qual é o seu convênio? A equipe pode ajudar a verificar o atendimento.'
      : unitRequired || externalRequestUnitRequired
        ? UNIT_REQUIRED_MESSAGE
        : intakeMissing
          ? intakeMissingMessage(intakeMissing, intakeMissingUnitId ? coverageFor(ctx, intakeMissingUnitId) : undefined)
          : null

  // Solicitação: dentro do horário de handoff a conversa vai para a equipe;
  // fora, fica pendente e a Clara segue disponível.
  let externalPlan: ExternalRequestPlan | null = null
  if (externalRequest) {
    const inHours = ctx.channelReady
      ? await probes.isHandoffAvailableNow(externalRequest.unitId, accountId, ctx.now).catch(() => true)
      : false
    externalPlan = { ...externalRequest, inHours }
  }

  let realHandoff = false
  let outOfHoursAppend: string | null = null
  if (canAttemptHandoff) {
    const handoffAvailable = await probes.isHandoffAvailableNow(handoffUnitId, accountId, ctx.now).catch(() => true)
    console.log(`[handoff] canAttempt=true handoffAvailableNow=${handoffAvailable}`)
    if (handoffAvailable) realHandoff = true
    else outOfHoursAppend = botConfig.outOfHoursMessage
  }

  const message: MessagePlan = {
    fixed,
    outsourcedMissing,
    discountFlagged,
    messageForPatient: markers.messageForPatient,
    externalRequest: externalPlan ? { unitName: externalPlan.unitName, inHours: externalPlan.inHours } : null,
    outOfHoursAppend,
    realHandoff,
    lastAssistantContent,
  }

  const loopEscalationMessage = handoffUnit?.handoffNumber
    ? `Desculpa, não estou conseguindo resolver isso sozinha. Vou te passar para a equipe de ${ctx.accountName}: ${handoffUnit.handoffNumber}`
    : 'Desculpa, não estou conseguindo resolver isso sozinha. Já avisei a equipe sobre sua solicitação — alguém vai te chamar em breve.'

  // Previsão do que o paciente veria, supondo que os efeitos deem certo.
  const predicted = resolveFinalMessage(message, {
    bookingFailed: false,
    outsourcedMessage: outsourcedPlanned ? requestedMessage({ scheduledAt: outsourcedPlanned.start, unitName: outsourcedPlanned.unitName }) : null,
    cancellationFailed: false,
  })
  const handoffUnitName = unitName(handoffUnitId)
  let reply = predicted
  const outgoing: string[] = []
  const transitionMessages = [botConfig.handoffMessage, ...(handoffUnit?.handoffNumber ? [`Contato: ${handoffUnit.handoffNumber}`] : [])]

  if (isLoopBreak(message, predicted)) {
    reply = loopEscalationMessage
    outgoing.push(loopEscalationMessage)
    effects.push({ kind: 'loop_breaker', workspace_id: handoffUnitId, unit_name: handoffUnitName })
  } else {
    if (predicted) outgoing.push(predicted)
    if (externalPlan?.inHours) {
      outgoing.push(...transitionMessages)
      effects.push({
        kind: 'handoff',
        reason: EXTERNAL_REQUEST_REASON,
        workspace_id: externalPlan.unitId,
        unit_name: externalPlan.unitName,
        summary: externalPlan.summary,
      })
    } else if (externalPlan) {
      effects.push({ kind: 'pending_request', workspace_id: externalPlan.unitId, unit_name: externalPlan.unitName, summary: externalPlan.summary })
    } else if (realHandoff) {
      outgoing.push(...transitionMessages)
      effects.push({ kind: 'handoff', reason: handoffCheck.reason!, workspace_id: handoffUnitId, unit_name: handoffUnitName, summary: null })
    } else if (canAttemptHandoff) {
      effects.push({ kind: 'handoff_unavailable', workspace_id: handoffUnitId, unit_name: handoffUnitName, reason: handoffCheck.reason! })
    }
  }

  return {
    markers,
    raw,
    discountFlagged,
    patient,
    conversationUnitId,
    effects,
    message,
    externalRequest: externalPlan,
    handoff: {
      unitId: handoffUnitId,
      notifyWorkspaceIds: handoffNotifyIds,
      reason: handoffCheck.reason,
      canAttempt: Boolean(canAttemptHandoff),
    },
    loopEscalationMessage,
    reply,
    outgoing,
  }
}
