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
import { getBotConfig } from '@/lib/bot/config'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import { detectHandoffIntent, executeHandoff, isHandoffAvailableNow, logHandoffUnavailable } from '@/lib/bot/handoff'
import type { Database } from '@/types/database'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ProcessMessageParams {
  workspaceId: string
  accountId: string
  workspaceName: string
  patientPhone: string
  message: string
  whatsappMessageId: string
}

// Data com offset explícito de São Paulo — evita que o `new Date(...)` do
// Node interprete o horário como local do servidor (Vercel roda em UTC).
const CONFIRMATION_MARKER = /AGENDAMENTO_CONFIRMADO:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?-03:00)/
// Cancelamento referencia o id real da consulta (copiado do system prompt),
// não um horário reconstruído — ver upcomingAppointments mais abaixo.
const CANCELLATION_MARKER = /CANCELAMENTO_CONFIRMADO:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
const PATIENT_NAME_MARKER = /NOME_PACIENTE:\s*(.+)/

// Mensagens fixas usadas quando o agendamento/cancelamento que a IA anunciou
// não bate no banco — comparadas literalmente contra a última mensagem do
// bot pra detectar quando a mesma falha se repete (ver repeatedAutomationFailure).
const BOOKING_FAILED_MESSAGE =
  'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro horário entre os que te passei, por favor?'
const CANCELLATION_FAILED_MESSAGE =
  'Não encontrei essa consulta no sistema para cancelar agora. Pode confirmar comigo a data e o horário certos? Se preferir, chamo alguém da equipe para te ajudar.'

type SupabaseAdmin = SupabaseClient<Database>

// Paciente por account (pacientes são compartilhados entre as workspaces do
// mesmo account) — usado tanto pra mensagens de texto quanto pra mídia não
// suportada. Sempre retorna um paciente ou lança — antes, um erro de insert
// (ex: duas mensagens quase simultâneas colidindo no unique(account_id,
// phone)) fazia a função devolver undefined em silêncio, e o resto do fluxo
// seguia sem paciente nenhum e sem nenhum erro registrado em lugar algum.
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
    // paciente entre o select acima e este insert; busca quem ganhou a
    // corrida em vez de falhar.
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

// Um único registro de conversa por paciente por workspace — nunca cria uma
// nova só porque a anterior foi resolvida; reabre a mesma linha em vez disso
// (a não ser que o bot esteja pausado por intervenção manual).
async function getOrCreateConversation(
  supabase: SupabaseAdmin,
  workspaceId: string,
  accountId: string,
  patientId: string | undefined,
  patientPhone: string
) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, status, bot_paused')
    .eq('workspace_id', workspaceId)
    .eq('patient_phone', patientPhone)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existing) {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ workspace_id: workspaceId, account_id: accountId, patient_id: patientId, patient_phone: patientPhone })
      .select('id, status, bot_paused')
      .single()
    if (!newConv) throw new Error('Failed to create conversation')
    return newConv
  }

  if (existing.status === 'resolved' && !existing.bot_paused) {
    await supabase.from('conversations').update({ status: 'open', resolved_at: null }).eq('id', existing.id)
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
  workspaceId: string
  accountId: string
  patientPhone: string
  messageType: string
  whatsappMessageId: string
}

// A Maria só entende texto — WhatsApp manda áudio, imagem, documento etc. com
// message.type diferente de "text", sem nada em message.text.body. Antes essas
// mensagens eram descartadas em silêncio (o paciente nunca via nenhuma
// resposta); isso pelo menos avisa e pede pra escrever.
export async function handleUnsupportedMessage(params: UnsupportedMessageParams) {
  const { workspaceId, accountId, patientPhone, messageType, whatsappMessageId } = params
  const supabase = createAdminClient()

  const botConfig = await getBotConfig(workspaceId)
  if (!botConfig || !botConfig.isActive) return

  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)
  const conversation = await getOrCreateConversation(supabase, workspaceId, accountId, patient?.id, patientPhone)

  const label = UNSUPPORTED_TYPE_LABELS[messageType] ?? 'esse tipo de mensagem'
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: `[${label} recebido]`,
    whatsapp_id: whatsappMessageId,
  })

  // Pausado por intervenção manual/handoff — mesma regra do texto: só registra.
  if (conversation.bot_paused) return

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('phone_number_id, meta_token')
    .eq('id', workspaceId)
    .single()

  if (!workspace?.phone_number_id || !workspace?.meta_token) return

  const reply = `Recebi seu ${label}, mas por enquanto só consigo entender mensagens em texto — pode escrever o que você precisa? 🙂`

  await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: reply })
  await sendWhatsAppMessage({
    to: patientPhone,
    message: reply,
    phoneNumberId: workspace.phone_number_id,
    token: decryptToken(workspace.meta_token),
  })
}

// O bot conversa e agenda 24/7 — nunca fica "fechado". Só o handoff para um
// humano tem horário próprio (handoff_hours), checado no passo 10.
export async function processIncomingMessage(params: ProcessMessageParams) {
  const supabase = createAdminClient()
  const { workspaceId, accountId, workspaceName, patientPhone, message, whatsappMessageId } = params

  // 1. Buscar configuração do bot — sem config ou inativo, o bot não responde
  // (a mensagem já ficou salva no webhook_logs para o médico ver depois).
  const botConfig = await getBotConfig(workspaceId)
  if (!botConfig || !botConfig.isActive) {
    console.warn(`Bot inativo ou sem configuração para workspace ${workspaceId}`)
    return
  }

  // 2. Buscar ou criar paciente (pacientes são por account, compartilhados
  // entre as workspaces do mesmo account)
  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)

  // 3. Buscar a conversa deste paciente (um único registro por paciente por
  // workspace — nunca cria uma nova só porque a anterior foi resolvida) ou
  // criar a primeira, se for o primeiro contato dele.
  const conversation = await getOrCreateConversation(supabase, workspaceId, accountId, patient?.id, patientPhone)

  // 4. Salvar mensagem do paciente
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: message,
    whatsapp_id: whatsappMessageId,
  })

  // Bot pausado (intervenção manual de um humano, ou handoff real em
  // andamento) — só registra a mensagem recebida, sem responder
  // automaticamente, até a equipe reativar pelo painel.
  if (conversation.bot_paused) {
    return
  }

  // 5. Buscar histórico da conversa
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: true })
    .limit(20)

  // A mensagem do paciente já foi inserida no passo 4, então na primeira
  // troca da conversa o histórico contém só ela (length === 1).
  const isFirstMessage = (history?.length ?? 0) <= 1

  // 6. Buscar horários livres reais (availability_rules + Google Calendar) —
  // sempre, a qualquer hora: o bot agenda 24/7, mesmo fora do expediente
  // presencial (os slots em si já refletem a agenda real do médico).
  const freeSlotsByDay: Record<string, string[]> = {}
  const today = new Date()
  for (let i = 1; i <= 10 && Object.keys(freeSlotsByDay).length < 5; i++) {
    const day = addDays(today, i)
    const slots = await getFreeSlotsForBot(workspaceId, day).catch(() => [])
    if (slots.length > 0) {
      // format(day, ...) sozinho lê o dia no fuso do servidor (UTC na
      // Vercel), não de São Paulo — perto da meia-noite BRT isso rotulava o
      // dia errado (o servidor já tinha virado a data ~3h antes daqui), mesmo
      // os horários em si já sendo calculados certos via TZDate dentro de
      // getAvailableSlots.
      freeSlotsByDay[format(new TZDate(day, 'America/Sao_Paulo'), 'yyyy-MM-dd')] = slots
    }
  }

  // 6.5. Buscar consultas futuras já agendadas deste paciente — a Maria
  // precisa saber o que já existe de verdade pra poder cancelar/remarcar
  // (sem isso, ela confirmava cancelamentos só na conversa, sem nada mudar
  // no banco nem no Google Calendar, e a consulta continuava aparecendo na
  // agenda).
  const { data: upcomingRows } = patient
    ? await supabase
        .from('appointments')
        .select('id, scheduled_at')
        .eq('workspace_id', workspaceId)
        .eq('patient_id', patient.id)
        .in('status', ['agendado', 'confirmado'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5)
    : { data: null }

  // O identificador que a IA copia pra cancelar é o id real da consulta, não
  // um horário reconstruído — evita a classe inteira de bug onde o marcador
  // que o Claude reconstrói (só com precisão de minuto) nunca bate contra um
  // scheduled_at que carrega segundos/milissegundos (ex: um evento do Google
  // Calendar movido manualmente e reconciliado de volta pro Supabase).
  const upcomingAppointments = (upcomingRows ?? []).map((row) => {
    const zoned = new TZDate(new Date(row.scheduled_at), 'America/Sao_Paulo')
    const dateLabel = zoned.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    const timeLabel = format(zoned, 'HH:mm')
    return {
      id: row.id,
      label: `${dateLabel} às ${timeLabel}`,
    }
  })

  // 7. Montar system prompt dinâmico e chamar Claude
  const systemPrompt = buildDynamicSystemPrompt({
    workspaceName,
    config: botConfig,
    freeSlotsByDay,
    isFirstMessage,
    upcomingAppointments,
  })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: (history ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  })

  if (response.content[0]?.type !== 'text') {
    console.error('Claude não retornou um bloco de texto', {
      workspaceId,
      conversationId: conversation.id,
      stopReason: response.stop_reason,
      contentTypes: response.content.map((b) => b.type),
    })
  }
  const rawMessage =
    response.content[0]?.type === 'text' ? response.content[0].text : 'Não consegui processar sua mensagem. Pode repetir?'

  // As linhas de marcação (agendamento, cancelamento, nome do paciente) são
  // lidas pelo sistema e não devem ir ao paciente.
  const cleanedMessage = rawMessage
    .replace(CONFIRMATION_MARKER, '')
    .replace(CANCELLATION_MARKER, '')
    .replace(PATIENT_NAME_MARKER, '')
    .trim()

  // Nome do paciente ainda é o placeholder "Paciente" (posto na criação, passo
  // 2) até ele se identificar na conversa — atualiza assim que o bot capturar.
  const nameMatch = rawMessage.match(PATIENT_NAME_MARKER)
  const patientName = nameMatch?.[1]?.trim()
  if (patient && patientName && patientName !== patient.full_name) {
    await supabase.from('patients').update({ full_name: patientName }).eq('id', patient.id)
    patient.full_name = patientName
  }

  // 8. Executar agendamento/cancelamento confirmados pela IA ANTES de montar a
  // resposta — se o Claude disser "cancelei" ou "confirmei" mas a operação
  // falhar no banco (ex: horário ocupado nesse meio tempo, consulta que já não
  // bate mais com o registro real), o paciente nunca pode receber uma
  // confirmação falsa; a resposta é substituída por uma correção honesta.
  let bookingFailed = false
  let cancellationFailed = false

  const confirmMatch = rawMessage.match(CONFIRMATION_MARKER)
  if (confirmMatch) {
    const scheduledAt = new Date(confirmMatch[1])
    const durationMin = 30

    if (!Number.isNaN(scheduledAt.getTime())) {
      // Revalida contra a disponibilidade real — o horário pode ter sido
      // ocupado entre o cálculo dos slots (passo 6) e a confirmação do paciente.
      const stillAvailable = await isSlotAvailable(workspaceId, scheduledAt, durationMin).catch(() => true)

      if (!stillAvailable) {
        console.warn(`Slot ${confirmMatch[1]} não está mais disponível para workspace ${workspaceId} — agendamento não criado.`)
        bookingFailed = true
      } else {
        const { data: appt } = await supabase
          .from('appointments')
          .insert({
            workspace_id: workspaceId,
            account_id: accountId,
            patient_id: patient?.id,
            patient_name: patient?.full_name ?? 'Paciente',
            patient_phone: patientPhone,
            scheduled_at: scheduledAt.toISOString(),
            duration_min: durationMin,
            source: 'bot',
            status: 'agendado',
          })
          .select()
          .single()

        if (appt) {
          await supabase.from('conversations').update({ appointment_id: appt.id }).eq('id', conversation.id)

          const { connected, email } = await isGoogleConnected(workspaceId)
          if (connected && email) {
            try {
              const gcalEvent = await createEvent({
                workspaceId,
                patientName: appt.patient_name,
                patientPhone: appt.patient_phone,
                appointmentType: appt.type,
                startTime: scheduledAt,
                durationMin,
                workspaceName,
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

  // Detectar cancelamento confirmado e atualizar o registro (status + Google
  // Calendar) — sem isso a consulta continuava "agendado" no banco mesmo
  // depois da Maria dizer ao paciente que tinha cancelado. Casa por id (não
  // por horário reconstruído) — o id é copiado do system prompt exatamente
  // como está no banco, então não sofre com precisão de timestamp.
  const cancelMatch = rawMessage.match(CANCELLATION_MARKER)
  if (cancelMatch && patient) {
    const apptId = cancelMatch[1]
    const { data: apptToCancel } = await supabase
      .from('appointments')
      .select('id, gcal_event_id')
      .eq('id', apptId)
      .eq('workspace_id', workspaceId)
      .eq('patient_id', patient.id)
      .in('status', ['agendado', 'confirmado'])
      .maybeSingle()

    if (apptToCancel) {
      await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', apptToCancel.id)

      if (apptToCancel.gcal_event_id) {
        try {
          await cancelEvent(workspaceId, apptToCancel.gcal_event_id)
        } catch (gcalErr) {
          console.error('Google Calendar cancel failed (bot cancellation):', gcalErr)
        }
      }
    } else {
      console.warn(
        `Cancelamento (id ${apptId}) não encontrou consulta correspondente para paciente ${patient.id} no workspace ${workspaceId}.`
      )
      cancellationFailed = true
    }
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('phone_number_id, meta_token')
    .eq('id', workspaceId)
    .single()

  const lastAssistantContent = [...(history ?? [])].reverse().find((m) => m.role === 'assistant')?.content

  // 9. Detectar necessidade de handoff para atendimento humano
  const handoffCheck = detectHandoffIntent(cleanedMessage, message)
  const canAttemptHandoff =
    handoffCheck.needed && botConfig.handoffNumber && workspace?.phone_number_id && workspace?.meta_token

  // 10. Decidir a mensagem final para o paciente e se o handoff acontece de
  // verdade. Se o agendamento/cancelamento que o Claude anunciou não bateu de
  // fato no banco (bookingFailed/cancellationFailed), a resposta do Claude é
  // descartada e substituída por uma mensagem honesta — nunca confirmamos ao
  // paciente algo que não aconteceu de verdade.
  let finalMessage: string
  if (bookingFailed) {
    finalMessage = BOOKING_FAILED_MESSAGE
  } else if (cancellationFailed) {
    finalMessage = CANCELLATION_FAILED_MESSAGE
  } else {
    finalMessage = cleanedMessage.replace('[HANDOFF]', '').trim()
  }
  let realHandoff = false

  if (canAttemptHandoff) {
    const handoffAvailable = await isHandoffAvailableNow(workspaceId).catch(() => true)
    if (handoffAvailable) {
      realHandoff = true
      // A mensagem de transição + número são enviadas separadamente por executeHandoff
    } else {
      // Handoff pedido fora do horário de atendimento humano — o bot segue
      // sozinho e avisa que a equipe humana vai responder assim que possível.
      finalMessage = finalMessage ? `${finalMessage}\n\n${botConfig.outOfHoursMessage}` : botConfig.outOfHoursMessage
    }
  }

  // 12. Disjuntor: se a resposta que estamos prestes a mandar é IDÊNTICA à
  // última coisa que o próprio bot já disse nessa conversa, é sinal de loop —
  // a IA tende a travar repetindo o mesmo texto quando o histórico já está
  // cheio dessa mesma resposta, seja por uma falha de agendamento/
  // cancelamento, seja por qualquer outro motivo (ex: a API não devolver um
  // bloco de texto, ver o console.error acima). Em vez de mandar a mesma
  // coisa de novo, escala pra um humano e pausa o bot.
  if (finalMessage && !realHandoff && finalMessage === lastAssistantContent) {
    const escalationMessage = botConfig.handoffNumber
      ? `Desculpa, não estou conseguindo resolver isso sozinha. Vou te passar para a equipe de ${workspaceName}: ${botConfig.handoffNumber}`
      : 'Desculpa, não estou conseguindo resolver isso sozinha. Já avisei a equipe sobre sua solicitação — alguém vai te chamar em breve.'

    await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: escalationMessage })
    await supabase
      .from('conversations')
      .update({ status: 'handoff', bot_paused: true, resolved_at: new Date().toISOString() })
      .eq('id', conversation.id)
    await supabase.from('handoff_logs').insert({
      workspace_id: workspaceId,
      conversation_id: conversation.id,
      patient_phone: patientPhone,
      trigger_reason: 'bot_uncertain',
      handoff_to: botConfig.handoffNumber ?? 'equipe (sem número configurado)',
    })

    if (workspace?.phone_number_id && workspace?.meta_token) {
      await sendWhatsAppMessage({
        to: patientPhone,
        message: escalationMessage,
        phoneNumberId: workspace.phone_number_id,
        token: decryptToken(workspace.meta_token),
      })
    }

    return
  }

  // 13. Salvar e enviar a mensagem final (vazia só quando a resposta do
  // Claude era só o marcador [HANDOFF], o que é normal num handoff real)
  if (finalMessage) {
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      role: 'assistant',
      content: finalMessage,
    })
  }

  if (workspace?.phone_number_id && workspace?.meta_token) {
    const metaToken = decryptToken(workspace.meta_token)

    if (finalMessage) {
      await sendWhatsAppMessage({
        to: patientPhone,
        message: finalMessage,
        phoneNumberId: workspace.phone_number_id,
        token: metaToken,
      })
    }

    if (realHandoff && botConfig.handoffNumber) {
      await executeHandoff({
        workspaceId,
        conversationId: conversation.id,
        patientPhone,
        handoffNumber: botConfig.handoffNumber,
        handoffMessage: botConfig.handoffMessage,
        phoneNumberId: workspace.phone_number_id,
        metaToken,
        triggerReason: handoffCheck.reason!,
      })
      return // conversa transferida de verdade — encerra o processamento
    }

    if (canAttemptHandoff && !realHandoff && botConfig.handoffNumber) {
      await logHandoffUnavailable({
        workspaceId,
        conversationId: conversation.id,
        patientPhone,
        handoffNumber: botConfig.handoffNumber,
      })
    }
  }

}
