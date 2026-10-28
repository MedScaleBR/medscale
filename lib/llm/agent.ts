import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { isSlotAvailable } from '@/lib/google/availability'
import { isGoogleConnected } from '@/lib/google/auth'
import { cancelEvent, createEvent, deleteEvent } from '@/lib/google/calendar'
import { getBotConfig, getAccountUnits } from '@/lib/bot/config'
import { EXTERNAL_REQUEST_REASON } from '@/lib/bot/unit-settings'
import {
  closeSupersededExternalRequests,
  EXTERNAL_REQUEST_PUSH_TITLE,
  externalRequestPushBody,
  recordPendingExternalRequest,
} from '@/lib/bot/external-request'
import { executeHandoff, logHandoffUnavailable } from '@/lib/bot/handoff'
import { broadcastToWorkspace } from '@/lib/realtime/broadcast'
import { createBookingRevenueEntry } from '@/lib/revenue/cycle'
import {
  trackMessageReceived,
  trackBotResponded,
  trackAppointmentBookedByBot,
  trackHandoffTriggered,
  trackUnsupportedMessageReceived,
  trackWaitlistPatientAddedByBot,
} from '@/lib/analytics/posthog-server'
import type { Database } from '@/types/database'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'
import { recordWhatsappConversation } from '@/lib/costs/record'
import { alreadyPendingMessage, REQUEST_FAILED_MESSAGE, requestedMessage } from '@/lib/outsourced/messages'
import { notifyOutsourcedIssue } from '@/lib/outsourced/notify'
import { requestExternalConfirmation } from '@/lib/outsourced/request'
import { buildAgentContext, loadAccountUnits, loadStoredIntake, type AgentContext, type AgentPatient } from '@/lib/llm/agent-context'
import { generateReply } from '@/lib/llm/agent-reply'
import {
  isLoopBreak,
  planEffects,
  resolveFinalMessage,
  type AgentEffect,
  type AgentPlan,
  type ApplyOutcome,
} from '@/lib/llm/agent-plan'

interface ProcessMessageParams {
  accountId: string
  patientPhone: string
  message: string
  whatsappMessageId: string
}

type SupabaseAdmin = SupabaseClient<Database>

// Paciente por account (pacientes são compartilhados entre as workspaces do
// mesmo account) — usado tanto pra mensagens de texto quanto pra mídia não
// suportada. Sempre retorna um paciente ou lança.
async function getOrCreatePatient(supabase: SupabaseAdmin, accountId: string, patientPhone: string) {
  const { data: patient, error: selectError } = await supabase
    .from('patients')
    .select('id, full_name, birth_date')
    .eq('account_id', accountId)
    .eq('phone', patientPhone)
    .maybeSingle()

  if (selectError) throw new Error(`getOrCreatePatient select failed: ${selectError.message}`)
  if (patient) return patient

  const { data: newPatient, error: insertError } = await supabase
    .from('patients')
    .insert({ account_id: accountId, phone: patientPhone, full_name: 'Paciente' })
    .select('id, full_name, birth_date')
    .single()

  if (insertError) {
    // 23505 = unique_violation — outra mensagem concorrente já criou o mesmo
    // paciente entre o select acima e este insert; busca quem ganhou a corrida.
    if (insertError.code === '23505') {
      const { data: existing, error: refetchError } = await supabase
        .from('patients')
        .select('id, full_name, birth_date')
        .eq('account_id', accountId)
        .eq('phone', patientPhone)
        .single()
      if (refetchError || !existing) {
        throw new Error(`getOrCreatePatient refetch after conflict failed: ${refetchError?.message}`)
      }
      return existing
    }
    throw new Error(`getOrCreatePatient insert failed: ${insertError.message}`)
  }
  if (!newPatient) throw new Error('getOrCreatePatient insert returned no data')

  return newPatient
}

// Um único registro de conversa por paciente por account (o número da Clara é
// único por account) — nunca cria uma nova só porque a anterior foi resolvida;
// reabre a mesma linha (a não ser que o bot esteja pausado por intervenção
// manual).
//
// `defaultWorkspaceId` é a unidade à qual a conversa já pertence antes de a
// Clara "perguntar": nas contas de uma unidade só ela é conhecida desde a
// primeira mensagem, então a conversa já nasce visível no /conversa daquela
// clínica. Nas contas com várias unidades vem NULL — a unidade só é gravada
// quando a Clara confirma qual (marcador UNIDADE_ID, passo 7.5).
async function getOrCreateConversation(
  supabase: SupabaseAdmin,
  accountId: string,
  patientId: string | undefined,
  patientPhone: string,
  defaultWorkspaceId: string | null = null
) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, status, bot_paused, archived_at, workspace_id')
    .eq('account_id', accountId)
    .eq('patient_phone', patientPhone)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existing) {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        patient_phone: patientPhone,
        workspace_id: defaultWorkspaceId,
      })
      .select('id, status, bot_paused, archived_at, workspace_id')
      .single()
    if (!newConv) throw new Error('Failed to create conversation')
    return newConv
  }

  const updates: {
    status?: 'open'
    resolved_at?: null
    archived_at?: null
    workspace_id?: string
  } = {}
  if (existing.status === 'resolved' && !existing.bot_paused) {
    updates.status = 'open'
    updates.resolved_at = null
  }
  if (existing.archived_at) {
    updates.archived_at = null
  }
  // Conversa antiga que ficou sem unidade (criada antes deste comportamento, ou
  // numa conta que só agora tem uma unidade) — liga na unidade conhecida.
  if (!existing.workspace_id && defaultWorkspaceId) {
    updates.workspace_id = defaultWorkspaceId
  }
  if (Object.keys(updates).length > 0) {
    await supabase.from('conversations').update(updates).eq('id', existing.id)
    Object.assign(existing, updates)
  }

  return existing
}

const UNSUPPORTED_TYPE_LABELS: Record<string, string> = {
  audio: 'áudio',
  image: 'imagem',
  video: 'vídeo',
  document: 'documento',
  sticker: 'figurinha',
  location: 'localização',
  contacts: 'contato',
}

// Toast in-app para a equipe quando o bot está pausado (handoff em andamento
// ou intervenção manual) e o paciente manda mais uma mensagem — o webhook só
// registra, então sem isto ninguém no sistema fica sabendo até dar refresh.
// Sem workspace_id resolvido não dá pra endereçar o canal; nesse caso, silêncio.
async function notifyHumanNeeded(
  conversation: { id: string; workspace_id: string | null },
  patient: { full_name: string } | null
): Promise<void> {
  if (!conversation.workspace_id) return
  await broadcastToWorkspace(conversation.workspace_id, 'handoff_message', {
    conversationId: conversation.id,
    patientName: patient?.full_name ?? 'Paciente',
  })
}

interface UnsupportedMessageParams {
  accountId: string
  patientPhone: string
  messageType: string
  whatsappMessageId: string
}

// A Clara só entende texto. Isso avisa o paciente e pede pra escrever.
export async function handleUnsupportedMessage(params: UnsupportedMessageParams) {
  const { accountId, patientPhone, messageType, whatsappMessageId } = params
  const supabase = createAdminClient()

  const botConfig = await getBotConfig(accountId)
  if (!botConfig || !botConfig.isActive) return

  // Conta com uma unidade só → a conversa já pertence a ela (ver getOrCreateConversation).
  const units = await getAccountUnits(accountId)
  const singleUnitId = units.length === 1 ? units[0].id : null

  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)
  const conversation = await getOrCreateConversation(
    supabase,
    accountId,
    patient?.id,
    patientPhone,
    singleUnitId
  )

  const label = UNSUPPORTED_TYPE_LABELS[messageType] ?? 'esse tipo de mensagem'
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: `[${label} recebido]`,
    whatsapp_id: whatsappMessageId,
  })

  await trackUnsupportedMessageReceived(accountId, {
    workspace_id: conversation.workspace_id ?? '',
    account_id: accountId,
    message_type: messageType,
  })

  // Pausado por intervenção manual/handoff — mesma regra do texto: só registra.
  if (conversation.bot_paused) {
    await notifyHumanNeeded(conversation, patient)
    return
  }

  if (!botConfig.phoneNumberId || !botConfig.metaToken) return

  const reply = `Recebi seu ${label}, mas por enquanto só consigo entender mensagens em texto — pode escrever o que você precisa? 🙂`

  await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: reply })
  await sendWhatsAppMessage({
    to: patientPhone,
    message: reply,
    phoneNumberId: botConfig.phoneNumberId,
    token: decryptToken(botConfig.metaToken),
  })
}

// O bot conversa e agenda 24/7 — nunca fica "fechado". Só o handoff para um
// humano tem horário próprio (handoff_hours).
//
// Pipeline: contexto (agent-context, só lê) → resposta do Claude (agent-reply)
// → plano de efeitos (agent-plan, só decide) → execução (applyEffects, aqui).
// O simulador da Clara (/admin) roda as três primeiras etapas e nunca a última.
export async function processIncomingMessage(params: ProcessMessageParams) {
  const supabase = createAdminClient()
  const { accountId, patientPhone, message, whatsappMessageId } = params

  // 1. Config da Clara (por account) — sem config ou inativa, não responde.
  const botConfig = await getBotConfig(accountId)
  if (!botConfig || !botConfig.isActive) {
    console.warn(`Clara inativa ou sem configuração para account ${accountId}`)
    return
  }

  // 1.1 Unidades da account + nome da account (a Clara pergunta a unidade).
  const account = await loadAccountUnits(supabase, accountId)
  const units = account.units
  if (units.length === 0) {
    console.warn(`account ${accountId} sem unidades ativas — Clara não tem onde agendar`)
    return
  }

  // 2. Paciente (por account).
  const patientRow = await getOrCreatePatient(supabase, accountId, patientPhone)

  // 3. Conversa deste paciente (uma por account+telefone). Numa conta de uma
  // unidade só, a conversa já nasce ligada a ela e aparece no /conversa daquela
  // clínica desde já; com várias, workspace_id fica NULL até a Clara confirmar
  // a unidade (marcador UNIDADE_ID).
  const singleUnitId = units.length === 1 ? units[0].id : null
  const conversation = await getOrCreateConversation(
    supabase,
    accountId,
    patientRow?.id,
    patientPhone,
    singleUnitId
  )

  // 4. Salvar mensagem do paciente
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: message,
    whatsapp_id: whatsappMessageId,
  })

  const { count: userMsgCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('role', 'user')
  await trackMessageReceived(accountId, {
    workspace_id: conversation.workspace_id ?? '',
    account_id: accountId,
    is_first_message: (userMsgCount ?? 1) <= 1,
  })

  // Janela de 24h da Meta. Só é custo NOSSO quando a MedScale provisionou o
  // número — com o App próprio da clínica ('own'), quem paga a Meta é ela.
  // Fica antes do short-circuit de bot_paused de propósito: a janela abre com
  // a mensagem do paciente, mesmo que a Clara não responda nada.
  if (botConfig.numberSource === 'medscale') {
    await recordWhatsappConversation({
      ctx: { accountId, workspaceId: conversation.workspace_id },
      conversationId: conversation.id,
    })
  }

  // Bot pausado (intervenção manual ou handoff em andamento) — só registra.
  if (conversation.bot_paused) {
    console.log(`[handoff] conversa ${conversation.id} está bot_paused — mensagem só registrada, bot não responde`)
    await notifyHumanNeeded(conversation, patientRow)
    return
  }

  // 5. Histórico — as 20 mensagens mais recentes, em ordem cronológica.
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content, sent_at')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: false })
    .limit(20)
  const chronological = recentMessages ? [...recentMessages].reverse() : []
  const history = (chronological[0]?.role === 'assistant' ? chronological.slice(1) : chronological).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    sent_at: m.sent_at ?? null,
  }))

  const patient: AgentPatient | null = patientRow
    ? { id: patientRow.id, full_name: patientRow.full_name, birth_date: patientRow.birth_date ?? null, persisted: true }
    : null
  const collected = new Set(units.flatMap((u) => u.botSettings?.intakeFields ?? []))

  // 6. Contexto (horários livres, consultas, catálogo, convênios) — só leitura.
  const ctx = await buildAgentContext({
    supabase,
    accountId,
    botConfig,
    account,
    patientPhone,
    patient,
    storedIntake: await loadStoredIntake(supabase, patient, collected),
    conversation: { id: conversation.id, workspace_id: conversation.workspace_id },
    message,
    history,
    now: new Date(),
    channelReady: Boolean(botConfig.phoneNumberId && botConfig.metaToken),
  })

  // 7. Prompt + Claude.
  const reply = await generateReply(ctx, { costProvider: 'claude_agendamento' })

  // 8. Plano: marcadores validados → o que deve acontecer.
  const plan = await planEffects(ctx, reply.raw)

  // 9. Execução.
  await applyEffects(ctx, plan, { supabase, conversationId: conversation.id })
}

interface ApplyIo {
  supabase: SupabaseAdmin
  conversationId: string
}

// Etapa 4 (só produção): grava, agenda, cancela, transfere e envia. O horário
// é revalidado aqui (isSlotAvailable), logo antes de gravar a consulta.
async function applyEffects(ctx: AgentContext, plan: AgentPlan, io: ApplyIo) {
  const { supabase, conversationId } = io
  const { accountId, accountName, botConfig, patientPhone, unitById } = ctx
  const patient = plan.patient
  const outcome: ApplyOutcome = { bookingFailed: false, outsourcedMessage: null, cancellationFailed: false }
  // Pedido à clínica parceira que não saiu (já havia pendente ou falhou) —
  // numa remarcação, aí a consulta antiga fica.
  let outsourcedNotRequested = false

  // Dados do paciente: nome, nascimento e, juntos, os da coleta por unidade.
  const saves = plan.effects.filter((e): e is Extract<AgentEffect, { kind: 'save_patient_field' }> => e.kind === 'save_patient_field')
  if (patient) {
    for (const save of saves) {
      if (save.field === 'full_name') await supabase.from('patients').update({ full_name: save.value }).eq('id', patient.id)
      if (save.field === 'birth_date') await supabase.from('patients').update({ birth_date: save.value }).eq('id', patient.id)
    }
    const intakeUpdate: Database['public']['Tables']['patients']['Update'] = {}
    for (const save of saves) {
      if (save.field === 'insurance_card_number' || save.field === 'cpf' || save.field === 'email') intakeUpdate[save.field] = save.value
    }
    if (Object.keys(intakeUpdate).length > 0) {
      const { error } = await supabase.from('patients').update(intakeUpdate).eq('id', patient.id)
      if (error) console.error(`[intake] gravação do paciente falhou conversation=${conversationId}`)
    }
  }

  for (const effect of plan.effects) {
    switch (effect.kind) {
      case 'set_conversation_unit':
        await supabase.from('conversations').update({ workspace_id: effect.workspace_id }).eq('id', conversationId)
        break

      case 'outsourced_request': {
        const scheduledAt = new Date(effect.start)
        // O plano só pede à clínica com paciente, nome e nascimento conhecidos.
        if (!patient?.full_name || !patient.birth_date) break
        if (!(await isSlotAvailable(effect.workspace_id, scheduledAt, effect.duration_min).catch(() => true))) {
          console.warn(`Slot ${plan.markers.confirmedSlot} não está mais disponível (unidade ${effect.workspace_id}) — solicitação não enviada.`)
          outcome.bookingFailed = true
          break
        }
        const result = await requestExternalConfirmation({
          supabase,
          accountId,
          accountName,
          unit: { id: effect.workspace_id, name: effect.unit_name, externalClinicPhone: effect.external_clinic_phone },
          patient: { id: patient.id, fullName: patient.full_name, birthDate: patient.birth_date },
          patientPhone,
          conversationId,
          scheduledAt,
          durationMin: effect.duration_min,
          insurer: effect.insurer,
          procedure: effect.procedure,
          replacingAppointmentId: effect.replacing_appointment_id,
          phoneNumberId: botConfig.phoneNumberId,
          metaToken: botConfig.metaToken ? decryptToken(botConfig.metaToken) : null,
        })
        outsourcedNotRequested = result.kind !== 'requested'
        outcome.outsourcedMessage =
          result.kind === 'requested'
            ? requestedMessage({ scheduledAt, unitName: effect.unit_name })
            : result.kind === 'already_pending'
              ? alreadyPendingMessage(effect.unit_name)
              : REQUEST_FAILED_MESSAGE
        break
      }

      case 'book':
        if (!(await bookAppointment(ctx, plan, io, effect))) outcome.bookingFailed = true
        break

      case 'cancel':
        if (effect.after_outsourced_request && outsourcedNotRequested) break
        if (!(await cancelAppointment(ctx, io, effect.appointment_id))) outcome.cancellationFailed = true
        break

      case 'waitlist':
        await addToWaitlist(ctx, plan, io, effect)
        break

      default:
        break
    }
  }

  const phoneNumberId = botConfig.phoneNumberId
  const metaToken = botConfig.metaToken ? decryptToken(botConfig.metaToken) : null
  const handoffUnitId = plan.handoff.unitId
  const handoffUnit = unitById.get(handoffUnitId)
  const externalRequest = plan.externalRequest
  const finalMessage = resolveFinalMessage(plan.message, outcome)

  // Disjuntor de loop — resposta idêntica à última do próprio bot.
  if (isLoopBreak(plan.message, finalMessage)) {
    console.log('[handoff] disjuntor de loop acionado (resposta repetida) — escalando para humano')
    const escalationMessage = plan.loopEscalationMessage

    await supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: escalationMessage })
    // Garante que a conversa fique visível no /conversa da clínica que vai atender.
    await supabase
      .from('conversations')
      .update({
        status: 'handoff',
        bot_paused: true,
        resolved_at: new Date().toISOString(),
        workspace_id: handoffUnitId,
      })
      .eq('id', conversationId)
    await supabase.from('handoff_logs').insert({
      workspace_id: handoffUnitId,
      conversation_id: conversationId,
      patient_phone: patientPhone,
      trigger_reason: 'bot_uncertain',
      handoff_to: handoffUnit?.handoffNumber ?? 'equipe (sem número configurado)',
    })
    await trackHandoffTriggered(accountId, {
      workspace_id: handoffUnitId,
      account_id: accountId,
      trigger_reason: 'bot_uncertain',
      handoff_available: false,
    })

    if (phoneNumberId && metaToken) {
      await sendWhatsAppMessage({ to: patientPhone, message: escalationMessage, phoneNumberId, token: metaToken })
    }

    try {
      const { sendHandoffPush } = await import('@/lib/push/send')
      await Promise.all(
        plan.handoff.notifyWorkspaceIds.map((wid) =>
          sendHandoffPush(wid, {
            title: '🔔 Atendimento solicitado',
            body: `${patient?.full_name ?? 'Paciente'} precisa de atendimento humano`,
            url: `/bot?c=${conversationId}`,
          })
        )
      )
    } catch (err) {
      console.error('[handoff] push notification failed', err)
    }

    return
  }

  // Salvar e enviar a mensagem final
  if (finalMessage) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: finalMessage,
    })
  }

  if (phoneNumberId && metaToken) {
    if (finalMessage) {
      await sendWhatsAppMessage({ to: patientPhone, message: finalMessage, phoneNumberId, token: metaToken })
      await trackBotResponded(accountId, {
        workspace_id: handoffUnitId,
        account_id: accountId,
        response_length: finalMessage.length,
      })
    }

    if (externalRequest && externalRequest.inHours) {
      console.log(`[handoff] solicitação de agendamento — transferência real workspace=${externalRequest.unitId}`)
      await closeSupersededExternalRequests(conversationId)
      await executeHandoff({
        workspaceId: externalRequest.unitId,
        accountId,
        conversationId,
        patientPhone,
        handoffNumber: handoffUnit?.handoffNumber ?? null,
        handoffMessage: botConfig.handoffMessage,
        phoneNumberId,
        metaToken,
        triggerReason: EXTERNAL_REQUEST_REASON,
        notifyWorkspaceIds: [externalRequest.unitId],
        summary: externalRequest.summary,
        push: {
          title: EXTERNAL_REQUEST_PUSH_TITLE,
          body: externalRequestPushBody(externalRequest.summary, externalRequest.unitName),
        },
      })
      return
    }

    if (plan.message.realHandoff) {
      console.log(`[handoff] executeHandoff() — transferência real (número ${handoffUnit?.handoffNumber ? 'configurado' : 'ausente'})`)
      await executeHandoff({
        workspaceId: handoffUnitId,
        accountId,
        conversationId,
        patientPhone,
        handoffNumber: handoffUnit?.handoffNumber ?? null,
        handoffMessage: botConfig.handoffMessage,
        phoneNumberId,
        metaToken,
        triggerReason: plan.handoff.reason!,
        notifyWorkspaceIds: plan.handoff.notifyWorkspaceIds,
        flaggedContent: plan.discountFlagged ? plan.raw : null,
      })
      return
    }

    if (plan.handoff.canAttempt) {
      await logHandoffUnavailable({
        workspaceId: handoffUnitId,
        accountId,
        conversationId,
        patientPhone,
        handoffNumber: handoffUnit?.handoffNumber ?? null,
      })
    }
  }

  // Fora do horário (ou sem WhatsApp configurado): a solicitação não se perde —
  // fica pendente no painel e a equipe é avisada. O bot não pausa.
  if (externalRequest && !externalRequest.inHours) {
    await recordPendingExternalRequest({
      accountId,
      workspaceId: externalRequest.unitId,
      unitName: externalRequest.unitName,
      conversationId,
      patientPhone,
      handoffNumber: handoffUnit?.handoffNumber ?? null,
      summary: externalRequest.summary,
    })
  }
}

// Agendamento confirmado numa unidade da MedScale. Revalida o horário antes de
// gravar; devolve false quando não agendou.
async function bookAppointment(
  ctx: AgentContext,
  plan: AgentPlan,
  io: ApplyIo,
  effect: Extract<AgentEffect, { kind: 'book' }>
): Promise<boolean> {
  const { supabase, conversationId } = io
  const { accountId, accountName, patientPhone, unitById } = ctx
  const patient = plan.patient
  const bookingUnitId = effect.workspace_id
  const scheduledAt = new Date(effect.start)
  const durationMin = effect.duration_min
  const resolvedProcedure = effect.procedure
  const selectedInsurer = effect.insurer
  const snapshotPrice = resolvedProcedure?.price ?? null

  const stillAvailable = await isSlotAvailable(bookingUnitId, scheduledAt, durationMin).catch(() => true)
  if (!stillAvailable) {
    console.warn(`Slot ${plan.markers.confirmedSlot} não está mais disponível (unidade ${bookingUnitId}) — agendamento não criado.`)
    return false
  }

  const { data: appt } = await supabase
    .from('appointments')
    .insert({
      workspace_id: bookingUnitId,
      account_id: accountId,
      patient_id: patient?.id,
      patient_name: patient?.full_name ?? 'Paciente',
      patient_phone: patientPhone,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: durationMin,
      source: 'bot',
      status: 'agendado',
      procedure_id: resolvedProcedure?.id ?? null,
      procedure_name: resolvedProcedure?.name ?? null,
      price: snapshotPrice,
      ...(selectedInsurer ? {
        billing_type: 'convenio' as const,
        insurer_id: selectedInsurer.id,
        health_plan: selectedInsurer.name,
      } : {}),
      ...(effect.reason ? { reason: effect.reason } : {}),
    })
    .select()
    .single()

  if (!appt) return false

  await supabase
    .from('conversations')
    .update({ appointment_id: appt.id, workspace_id: bookingUnitId })
    .eq('id', conversationId)

  if (!selectedInsurer) {
    await createBookingRevenueEntry(supabase, {
      workspaceId: bookingUnitId,
      accountId,
      appointmentId: appt.id,
      patientId: patient?.id ?? null,
      procedureId: resolvedProcedure?.id ?? null,
      procedureName: resolvedProcedure?.name ?? null,
      amount: snapshotPrice,
      scheduledAt: scheduledAt.toISOString(),
      source: 'bot',
    })
  }

  // Paciente que estava na lista de espera e acabou de agendar sai da lista.
  if (patient?.id) {
    await supabase
      .from('waitlist')
      .update({ status: 'scheduled' })
      .eq('workspace_id', bookingUnitId)
      .eq('patient_id', patient.id)
      .eq('status', 'waiting')
  }

  await trackAppointmentBookedByBot(accountId, {
    workspace_id: bookingUnitId,
    account_id: accountId,
    slot_datetime: scheduledAt.toISOString(),
  })

  const { connected, email } = await isGoogleConnected(accountId)
  if (connected && email) {
    try {
      const gcalEvent = await createEvent({
        workspaceId: bookingUnitId,
        patientName: appt.patient_name,
        patientPhone: appt.patient_phone,
        appointmentType: appt.type,
        startTime: scheduledAt,
        durationMin,
        workspaceName: unitById.get(bookingUnitId)?.name ?? accountName,
        doctorEmail: email,
      })
      if (gcalEvent.id) {
        await supabase.from('appointments').update({ gcal_event_id: gcalEvent.id }).eq('id', appt.id)
      }
    } catch (gcalErr) {
      console.error('Google Calendar sync failed (bot booking):', gcalErr)
    }
  }
  return true
}

// Cancelamento confirmado — casa por id (copiado do system prompt) + paciente.
// Devolve false quando não encontrou a consulta.
async function cancelAppointment(ctx: AgentContext, io: ApplyIo, apptId: string): Promise<boolean> {
  const { supabase } = io
  const { accountId, unitById } = ctx
  const patient = ctx.patient
  if (!patient) return true

  const { data: apptToCancel } = await supabase
    .from('appointments')
    .select('id, gcal_event_id, workspace_id')
    .eq('id', apptId)
    .eq('account_id', accountId)
    .eq('patient_id', patient.id)
    .in('status', ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS])
    .maybeSingle()

  if (!apptToCancel) {
    console.warn(`Cancelamento (id ${apptId}) não encontrou consulta para paciente ${patient.id} na account ${accountId}.`)
    return false
  }

  const outsourced = unitById.get(apptToCancel.workspace_id ?? '')?.isOutsourced === true
  await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', apptToCancel.id)

  if (apptToCancel.gcal_event_id && apptToCancel.workspace_id) {
    try {
      // Terceirizada: o evento é só o espelho do pedido — apaga em vez de marcar cancelado.
      await (outsourced ? deleteEvent : cancelEvent)(apptToCancel.workspace_id, apptToCancel.gcal_event_id)
    } catch (gcalErr) {
      console.error('Google Calendar cancel failed (bot cancellation):', gcalErr)
    }
  }

  if (outsourced && apptToCancel.workspace_id) {
    await notifyOutsourcedIssue({
      accountId,
      workspaceId: apptToCancel.workspace_id,
      appointmentId: apptToCancel.id,
      reason: 'cancelamento_terceirizado',
    })
  }
  return true
}

// Lista de espera — a Clara emite LISTA_ESPERA quando o paciente, sem vaga no
// dia que queria, opta por ser avisado em vez de escolher outro horário.
async function addToWaitlist(
  ctx: AgentContext,
  plan: AgentPlan,
  io: ApplyIo,
  effect: Extract<AgentEffect, { kind: 'waitlist' }>
): Promise<void> {
  const { supabase } = io
  const { accountId, patientPhone } = ctx
  const patient = plan.patient
  if (!patient) return

  const { data: existing } = await supabase
    .from('waitlist')
    .select('id')
    .eq('workspace_id', effect.workspace_id)
    .eq('patient_phone', patientPhone)
    .eq('desired_date', effect.date)
    .eq('status', 'waiting')
    .maybeSingle()

  if (existing) {
    await supabase
      .from('waitlist')
      .update({
        patient_id: patient.id,
        patient_name: patient.full_name ?? 'Paciente',
        desired_time: effect.time,
      })
      .eq('id', existing.id)
    return
  }

  const { error: waitlistError } = await supabase.from('waitlist').insert({
    workspace_id: effect.workspace_id,
    account_id: accountId,
    patient_id: patient.id,
    patient_name: patient.full_name ?? 'Paciente',
    patient_phone: patientPhone,
    desired_date: effect.date,
    desired_time: effect.time,
    source: 'bot',
    status: 'waiting',
  })
  if (waitlistError) {
    console.error('waitlist insert (bot) falhou', waitlistError)
  } else {
    await trackWaitlistPatientAddedByBot(accountId, {
      workspace_id: effect.workspace_id,
      account_id: accountId,
    })
  }
}
