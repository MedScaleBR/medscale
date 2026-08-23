import Anthropic from '@anthropic-ai/sdk'
import { addDays, format } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getFreeSlotsForBot, isSlotAvailable } from '@/lib/google/availability'
import { isGoogleConnected } from '@/lib/google/auth'
import { createEvent } from '@/lib/google/calendar'
import { getBotConfig } from '@/lib/bot/config'
import { buildDynamicSystemPrompt } from '@/lib/bot/prompt-builder'
import { detectHandoffIntent, executeHandoff, isHandoffAvailableNow, logHandoffUnavailable } from '@/lib/bot/handoff'

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
  let { data: patient } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('account_id', accountId)
    .eq('phone', patientPhone)
    .single()

  if (!patient) {
    const { data: newPatient } = await supabase
      .from('patients')
      .insert({ account_id: accountId, phone: patientPhone, full_name: 'Paciente' })
      .select()
      .single()
    patient = newPatient
  }

  // 3. Buscar conversa aberta ou criar nova
  let { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('patient_phone', patientPhone)
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conversation) {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ workspace_id: workspaceId, account_id: accountId, patient_id: patient?.id, patient_phone: patientPhone })
      .select()
      .single()
    conversation = newConv
  }

  if (!conversation) throw new Error('Failed to create conversation')

  // 4. Salvar mensagem do paciente
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: message,
    whatsapp_id: whatsappMessageId,
  })

  // 5. Buscar histórico e contar turnos
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: true })
    .limit(20)

  const turnCount = Math.floor((history?.length ?? 0) / 2)
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
      freeSlotsByDay[format(day, 'yyyy-MM-dd')] = slots
    }
  }

  // 7. Montar system prompt dinâmico e chamar Claude
  const systemPrompt = buildDynamicSystemPrompt({ workspaceName, config: botConfig, freeSlotsByDay, isFirstMessage })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: (history ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  })

  const rawMessage =
    response.content[0]?.type === 'text' ? response.content[0].text : 'Não consegui processar sua mensagem. Pode repetir?'

  // A linha de marcação de agendamento é lida pelo sistema, não deve ir ao paciente
  const cleanedMessage = rawMessage.replace(CONFIRMATION_MARKER, '').trim()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('phone_number_id, meta_token')
    .eq('id', workspaceId)
    .single()

  // 8. Detectar necessidade de handoff para atendimento humano
  const handoffCheck = detectHandoffIntent(cleanedMessage, message, turnCount)
  const canAttemptHandoff =
    handoffCheck.needed && botConfig.handoffNumber && workspace?.phone_number_id && workspace?.meta_token

  // 9. Decidir a mensagem final para o paciente e se o handoff acontece de verdade
  let finalMessage = cleanedMessage.replace('[HANDOFF]', '').trim()
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

  // 10. Salvar e enviar a mensagem final (vazia só quando a resposta do
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

  // 11. Detectar confirmação de agendamento e criar registro
  const match = rawMessage.match(CONFIRMATION_MARKER)
  if (match) {
    const scheduledAt = new Date(match[1])
    const durationMin = 30

    if (!Number.isNaN(scheduledAt.getTime())) {
      // Revalida contra a disponibilidade real — o horário pode ter sido
      // ocupado entre o cálculo dos slots (passo 6) e a confirmação do paciente.
      const stillAvailable = await isSlotAvailable(workspaceId, scheduledAt, durationMin).catch(() => true)

      if (!stillAvailable) {
        console.warn(`Slot ${match[1]} não está mais disponível para workspace ${workspaceId} — agendamento não criado.`)
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
        }
      }
    }
  }
}
