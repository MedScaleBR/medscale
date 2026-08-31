import Anthropic from '@anthropic-ai/sdk'
import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getFreeSlotsForBot, isSlotAvailable } from '@/lib/google/availability'
import { isGoogleConnected } from '@/lib/google/auth'
import { cancelEvent, createEvent } from '@/lib/google/calendar'
import { getBotConfig, getAccountUnits } from '@/lib/bot/config'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import { detectHandoffIntent, executeHandoff, isHandoffAvailableNow, logHandoffUnavailable } from '@/lib/bot/handoff'
import { parseMarkers } from '@/lib/bot/parse-markers'
import { createBookingRevenueEntry } from '@/lib/revenue/cycle'
import {
  trackMessageReceived,
  trackBotResponded,
  trackAppointmentBookedByBot,
  trackHandoffTriggered,
  trackUnsupportedMessageReceived,
} from '@/lib/analytics/posthog-server'
import type { Database } from '@/types/database'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ProcessMessageParams {
  accountId: string
  patientPhone: string
  message: string
  whatsappMessageId: string
}

// Mensagens fixas usadas quando o agendamento/cancelamento que a IA anunciou
// não bate no banco — comparadas literalmente contra a última mensagem do
// bot pra detectar quando a mesma falha se repete (ver repeatedAutomationFailure).
const BOOKING_FAILED_MESSAGE =
  'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro horário entre os que te passei, por favor?'
const UNIT_REQUIRED_MESSAGE =
  'Só preciso confirmar: em qual unidade você prefere ser atendido?'
const CANCELLATION_FAILED_MESSAGE =
  'Não encontrei essa consulta no sistema para cancelar agora. Pode confirmar comigo a data e o horário certos? Se preferir, chamo alguém da equipe para te ajudar.'

type SupabaseAdmin = SupabaseClient<Database>

// Paciente por account (pacientes são compartilhados entre as workspaces do
// mesmo account) — usado tanto pra mensagens de texto quanto pra mídia não
// suportada. Sempre retorna um paciente ou lança.
async function getOrCreatePatient(supabase: SupabaseAdmin, accountId: string, patientPhone: string) {
  const { data: patient, error: selectError } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('account_id', accountId)
    .eq('phone', patientPhone)
    .maybeSingle()

  if (selectError) throw new Error(`getOrCreatePatient select failed: ${selectError.message}`)
  if (patient) return patient

  const { data: newPatient, error: insertError } = await supabase
    .from('patients')
    .insert({ account_id: accountId, phone: patientPhone, full_name: 'Paciente' })
    .select('id, full_name')
    .single()

  if (insertError) {
    // 23505 = unique_violation — outra mensagem concorrente já criou o mesmo
    // paciente entre o select acima e este insert; busca quem ganhou a corrida.
    if (insertError.code === '23505') {
      const { data: existing, error: refetchError } = await supabase
        .from('patients')
        .select('id, full_name')
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

// Um único registro de conversa por paciente por account (o número da Maria é
// único por account) — nunca cria uma nova só porque a anterior foi resolvida;
// reabre a mesma linha (a não ser que o bot esteja pausado por intervenção
// manual). workspace_id fica NULL até a Maria confirmar a unidade.
async function getOrCreateConversation(
  supabase: SupabaseAdmin,
  accountId: string,
  patientId: string | undefined,
  patientPhone: string
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
      .insert({ account_id: accountId, patient_id: patientId, patient_phone: patientPhone })
      .select('id, status, bot_paused, archived_at, workspace_id')
      .single()
    if (!newConv) throw new Error('Failed to create conversation')
    return newConv
  }

  const updates: { status?: 'open'; resolved_at?: null; archived_at?: null } = {}
  if (existing.status === 'resolved' && !existing.bot_paused) {
    updates.status = 'open'
    updates.resolved_at = null
  }
  if (existing.archived_at) {
    updates.archived_at = null
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

interface UnsupportedMessageParams {
  accountId: string
  patientPhone: string
  messageType: string
  whatsappMessageId: string
}

// A Maria só entende texto. Isso avisa o paciente e pede pra escrever.
export async function handleUnsupportedMessage(params: UnsupportedMessageParams) {
  const { accountId, patientPhone, messageType, whatsappMessageId } = params
  const supabase = createAdminClient()

  const botConfig = await getBotConfig(accountId)
  if (!botConfig || !botConfig.isActive) return

  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)
  const conversation = await getOrCreateConversation(supabase, accountId, patient?.id, patientPhone)

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
  if (conversation.bot_paused) return

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

// Slots livres de uma unidade nos próximos dias (até `maxDays` dias com vaga).
async function collectFreeSlots(unitId: string, maxDays = 4): Promise<Record<string, string[]>> {
  const byDay: Record<string, string[]> = {}
  const today = new Date()
  for (let i = 1; i <= 12 && Object.keys(byDay).length < maxDays; i++) {
    const day = addDays(today, i)
    const slots = await getFreeSlotsForBot(unitId, day).catch(() => [])
    if (slots.length > 0) {
      byDay[format(new TZDate(day, 'America/Sao_Paulo'), 'yyyy-MM-dd')] = slots
    }
  }
  return byDay
}

// O bot conversa e agenda 24/7 — nunca fica "fechado". Só o handoff para um
// humano tem horário próprio (handoff_hours), checado no passo 10.
export async function processIncomingMessage(params: ProcessMessageParams) {
  const supabase = createAdminClient()
  const { accountId, patientPhone, message, whatsappMessageId } = params

  // 1. Config da Maria (por account) — sem config ou inativa, não responde.
  const botConfig = await getBotConfig(accountId)
  if (!botConfig || !botConfig.isActive) {
    console.warn(`Maria inativa ou sem configuração para account ${accountId}`)
    return
  }

  // 1.1 Unidades da account + nome da account (a Maria pergunta a unidade).
  const [allUnits, { data: account }] = await Promise.all([
    getAccountUnits(accountId),
    supabase.from('accounts').select('name').eq('id', accountId).single(),
  ])
  if (allUnits.length === 0) {
    console.warn(`account ${accountId} sem unidades ativas — Maria não tem onde agendar`)
    return
  }
  const accountName = account?.name ?? 'nossa clínica'
  const allUnitById = new Map(allUnits.map((u) => [u.id, u]))

  // 2. Paciente (por account).
  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)

  // 3. Conversa deste paciente (uma por account+telefone).
  const conversation = await getOrCreateConversation(supabase, accountId, patient?.id, patientPhone)

  // 3.1 Trava de unidade: assim que o paciente escolhe a unidade (marcador
  // UNIDADE_ID numa resposta anterior), conversation.workspace_id fica gravado
  // e a partir daí SÓ os horários dessa unidade entram no prompt — sem risco
  // de oferecer horário de outra unidade.
  const lockedUnitId =
    conversation.workspace_id && allUnitById.has(conversation.workspace_id) ? conversation.workspace_id : null
  const units = lockedUnitId ? allUnits.filter((u) => u.id === lockedUnitId) : allUnits
  const multiUnit = units.length > 1

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

  // Bot pausado (intervenção manual ou handoff em andamento) — só registra.
  if (conversation.bot_paused) {
    console.log(`[handoff] conversa ${conversation.id} está bot_paused — mensagem só registrada, bot não responde`)
    return
  }

  // 5. Histórico — as 20 mensagens mais recentes, em ordem cronológica.
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: false })
    .limit(20)
  const chronological = recentMessages ? [...recentMessages].reverse() : []
  const history = chronological[0]?.role === 'assistant' ? chronological.slice(1) : chronological

  const isFirstMessage = (history?.length ?? 0) <= 1

  // 6. Horários livres reais por unidade (availability_rules + Google Calendar).
  const slotsPerUnit = await Promise.all(units.map((u) => collectFreeSlots(u.id)))
  const freeSlotsByUnit: Record<string, Record<string, string[]>> = {}
  units.forEach((u, i) => {
    freeSlotsByUnit[u.id] = slotsPerUnit[i]
  })

  // 6.5. Consultas futuras já agendadas deste paciente — todas as unidades.
  const { data: upcomingRows } = patient
    ? await supabase
        .from('appointments')
        .select('id, scheduled_at, workspace_id')
        .eq('account_id', accountId)
        .eq('patient_id', patient.id)
        .in('status', ['agendado', 'confirmado'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5)
    : { data: null }

  const upcomingAppointments = (upcomingRows ?? []).map((row) => {
    const zoned = new TZDate(new Date(row.scheduled_at), 'America/Sao_Paulo')
    const dateLabel = zoned.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    const timeLabel = format(zoned, 'HH:mm')
    const unitName = row.workspace_id ? allUnitById.get(row.workspace_id)?.name : null
    return {
      id: row.id,
      label: `${dateLabel} às ${timeLabel}${multiUnit && unitName ? ` — ${unitName}` : ''}`,
    }
  })

  // 6.6. Catálogo de procedimentos por unidade (ciclo de receita). Carrega de
  // todas as unidades — o prompt só mostra as de `units`, mas o agendamento
  // pode resolver uma unidade fora dessa lista se o paciente trocar.
  const { data: catalogRows } = await supabase
    .from('procedure_catalog')
    .select('id, name, default_price, workspace_id')
    .in('workspace_id', allUnits.map((u) => u.id))
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

  // 7. System prompt dinâmico + Claude
  const systemPrompt = buildDynamicSystemPrompt({
    accountName,
    config: botConfig,
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      address: u.address,
      businessHours: u.businessHours,
      directionsParking: u.directionsParking,
      contactInfo: u.contactInfo,
      consultationPriceFrom: u.consultationPriceFrom,
    })),
    freeSlotsByUnit,
    procedureCatalogByUnit,
    isFirstMessage,
    upcomingAppointments,
    unitLocked: Boolean(lockedUnitId),
  })

  const claudeMessages = (history ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  let responseText: string | null = null
  for (let attempt = 1; attempt <= 2 && responseText === null; attempt++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    })

    if (response.content[0]?.type === 'text' && response.content[0].text.trim()) {
      responseText = response.content[0].text
    } else {
      console.error(`Claude não retornou um bloco de texto (tentativa ${attempt}/2)`, {
        accountId,
        conversationId: conversation.id,
        stopReason: response.stop_reason,
        contentTypes: response.content.map((b) => b.type),
      })
    }
  }
  const rawMessage = responseText ?? 'Não consegui processar sua mensagem. Pode repetir?'

  const markers = parseMarkers(rawMessage)
  const cleanedMessage = markers.cleanedMessage

  const patientName = markers.patientName
  if (patient && patientName && patientName !== patient.full_name) {
    await supabase.from('patients').update({ full_name: patientName }).eq('id', patient.id)
    patient.full_name = patientName
  }

  // 7.5 Trava de unidade: a Maria emite UNIDADE_ID assim que o paciente escolhe
  // a unidade (mesmo antes de confirmar um horário). Grava na conversa para as
  // próximas mensagens só carregarem os horários dessa unidade.
  if (
    markers.unitId &&
    allUnitById.has(markers.unitId) &&
    conversation.workspace_id !== markers.unitId
  ) {
    await supabase.from('conversations').update({ workspace_id: markers.unitId }).eq('id', conversation.id)
    conversation.workspace_id = markers.unitId
  }

  // 8. Executar agendamento/cancelamento confirmados ANTES de montar a resposta.
  let bookingFailed = false
  let unitRequired = false
  let cancellationFailed = false
  // Unidade envolvida nesta troca (agendamento, ou contexto atual da conversa) —
  // usada também pelo handoff mais abaixo.
  let resolvedUnitId: string | null = conversation.workspace_id ?? (units.length === 1 ? units[0].id : null)

  if (markers.confirmedDate) {
    const bookingUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
      lockedUnitId ??
      (allUnits.length === 1 ? allUnits[0].id : null)

    if (!bookingUnitId) {
      // A Maria confirmou um horário sem dizer a unidade (account com várias) —
      // não dá pra agendar; pede a unidade em vez de confirmar algo falso.
      unitRequired = true
    } else {
      resolvedUnitId = bookingUnitId
      const scheduledAt = markers.confirmedDate
      const durationMin = 30

      const unitCatalog = procedureCatalogByUnit[bookingUnitId] ?? []
      const resolvedProcedure = markers.procedureId
        ? unitCatalog.find((p) => p.id === markers.procedureId) ??
          flatCatalog.find((p) => p.id === markers.procedureId) ??
          null
        : null
      const snapshotPrice =
        resolvedProcedure?.price ?? allUnitById.get(bookingUnitId)?.consultationPriceFrom ?? null

      const stillAvailable = await isSlotAvailable(bookingUnitId, scheduledAt, durationMin).catch(() => true)

      if (!stillAvailable) {
        console.warn(`Slot ${markers.confirmedSlot} não está mais disponível (unidade ${bookingUnitId}) — agendamento não criado.`)
        bookingFailed = true
      } else {
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
          })
          .select()
          .single()

        if (appt) {
          await supabase
            .from('conversations')
            .update({ appointment_id: appt.id, workspace_id: bookingUnitId })
            .eq('id', conversation.id)

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
                workspaceName: allUnitById.get(bookingUnitId)?.name ?? accountName,
                doctorEmail: email,
              })
              if (gcalEvent.id) {
                await supabase.from('appointments').update({ gcal_event_id: gcalEvent.id }).eq('id', appt.id)
              }
            } catch (gcalErr) {
              console.error('Google Calendar sync failed (bot booking):', gcalErr)
            }
          }
        } else {
          bookingFailed = true
        }
      }
    }
  }

  // Cancelamento confirmado — casa por id (copiado do system prompt) + paciente.
  if (markers.cancelledAppointmentId && patient) {
    const apptId = markers.cancelledAppointmentId
    const { data: apptToCancel } = await supabase
      .from('appointments')
      .select('id, gcal_event_id, workspace_id')
      .eq('id', apptId)
      .eq('account_id', accountId)
      .eq('patient_id', patient.id)
      .in('status', ['agendado', 'confirmado'])
      .maybeSingle()

    if (apptToCancel) {
      await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', apptToCancel.id)

      if (apptToCancel.gcal_event_id && apptToCancel.workspace_id) {
        try {
          await cancelEvent(apptToCancel.workspace_id, apptToCancel.gcal_event_id)
        } catch (gcalErr) {
          console.error('Google Calendar cancel failed (bot cancellation):', gcalErr)
        }
      }
    } else {
      console.warn(`Cancelamento (id ${apptId}) não encontrou consulta para paciente ${patient.id} na account ${accountId}.`)
      cancellationFailed = true
    }
  }

  const phoneNumberId = botConfig.phoneNumberId
  const metaToken = botConfig.metaToken ? decryptToken(botConfig.metaToken) : null

  const lastAssistantContent = [...(history ?? [])].reverse().find((m) => m.role === 'assistant')?.content

  // 9. Handoff — a unidade de contato/horário é a da conversa (ou a única).
  const handoffUnitId = resolvedUnitId ?? units[0].id
  const handoffUnit = allUnitById.get(handoffUnitId)
  const handoffCheck = detectHandoffIntent(cleanedMessage, message)
  const canAttemptHandoff = handoffCheck.needed && phoneNumberId && metaToken

  console.log(
    `[handoff] needed=${handoffCheck.needed} reason=${handoffCheck.reason ?? '-'} ` +
      `unit=${handoffUnitId} hasNumber=${Boolean(handoffUnit?.handoffNumber)} ` +
      `hasPhoneId=${Boolean(phoneNumberId)} hasToken=${Boolean(metaToken)} canAttempt=${Boolean(canAttemptHandoff)}`
  )

  // 10. Mensagem final para o paciente. Se o agendamento/cancelamento não bateu
  // no banco, a resposta do Claude é descartada e substituída por algo honesto.
  let finalMessage: string
  if (unitRequired) {
    finalMessage = UNIT_REQUIRED_MESSAGE
  } else if (bookingFailed) {
    finalMessage = BOOKING_FAILED_MESSAGE
  } else if (cancellationFailed) {
    finalMessage = CANCELLATION_FAILED_MESSAGE
  } else {
    finalMessage = markers.messageForPatient
  }
  let realHandoff = false

  if (canAttemptHandoff) {
    const handoffAvailable = await isHandoffAvailableNow(handoffUnitId).catch(() => true)
    console.log(`[handoff] canAttempt=true handoffAvailableNow=${handoffAvailable}`)
    if (handoffAvailable) {
      realHandoff = true
    } else {
      finalMessage = finalMessage ? `${finalMessage}\n\n${botConfig.outOfHoursMessage}` : botConfig.outOfHoursMessage
    }
  }

  // 12. Disjuntor de loop — resposta idêntica à última do próprio bot.
  if (finalMessage && !realHandoff && finalMessage === lastAssistantContent) {
    console.log('[handoff] disjuntor de loop acionado (resposta repetida) — escalando para humano')
    const escalationMessage = handoffUnit?.handoffNumber
      ? `Desculpa, não estou conseguindo resolver isso sozinha. Vou te passar para a equipe de ${accountName}: ${handoffUnit.handoffNumber}`
      : 'Desculpa, não estou conseguindo resolver isso sozinha. Já avisei a equipe sobre sua solicitação — alguém vai te chamar em breve.'

    await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: escalationMessage })
    await supabase
      .from('conversations')
      .update({ status: 'handoff', bot_paused: true, resolved_at: new Date().toISOString() })
      .eq('id', conversation.id)
    await supabase.from('handoff_logs').insert({
      workspace_id: handoffUnitId,
      conversation_id: conversation.id,
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
      await sendHandoffPush(handoffUnitId, {
        title: '🔔 Atendimento solicitado',
        body: `${patient?.full_name ?? 'Paciente'} precisa de atendimento humano`,
        url: `/bot?c=${conversation.id}`,
      })
    } catch (err) {
      console.error('[handoff] push notification failed', err)
    }

    return
  }

  // 13. Salvar e enviar a mensagem final
  if (finalMessage) {
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
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

    if (realHandoff) {
      console.log(`[handoff] executeHandoff() — transferência real (número ${handoffUnit?.handoffNumber ? 'configurado' : 'ausente'})`)
      await executeHandoff({
        workspaceId: handoffUnitId,
        accountId,
        conversationId: conversation.id,
        patientPhone,
        handoffNumber: handoffUnit?.handoffNumber ?? null,
        handoffMessage: botConfig.handoffMessage,
        phoneNumberId,
        metaToken,
        triggerReason: handoffCheck.reason!,
      })
      return
    }

    if (canAttemptHandoff && !realHandoff) {
      await logHandoffUnavailable({
        workspaceId: handoffUnitId,
        accountId,
        conversationId: conversation.id,
        patientPhone,
        handoffNumber: handoffUnit?.handoffNumber ?? null,
      })
    }
  }
}
