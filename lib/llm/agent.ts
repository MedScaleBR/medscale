import Anthropic from '@anthropic-ai/sdk'
import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getFreeSlotsForBot, isSlotAvailable } from '@/lib/google/availability'
import { isGoogleConnected } from '@/lib/google/auth'
import { cancelEvent, createEvent, deleteEvent } from '@/lib/google/calendar'
import { getBotConfig, getAccountUnits } from '@/lib/bot/config'
import { buildDynamicSystemPrompt, wrapPatientMessage } from '@/lib/bot/prompt-builder'
import {
  containsUnconfiguredDiscount,
  detectInjectionAttempt,
  sanitizePatientName,
  parseBirthDate,
  parseIsoBirthDate,
  parseCardNumber,
  parseCpf,
  parseEmail,
  sanitizeShortText,
  type InjectionSignal,
} from '@/lib/bot/security'
import {
  EXTERNAL_BOOKING_BLOCKED_MESSAGE,
  externalRequestInHoursMessage,
  externalRequestOutOfHoursMessage,
  intakeMissingMessage,
  missingIntakeFields,
  type IntakeField,
} from '@/lib/bot/unit-settings'
import {
  closeSupersededExternalRequests,
  EXTERNAL_REQUEST_PUSH_TITLE,
  EXTERNAL_REQUEST_REASON,
  externalRequestPushBody,
  recordPendingExternalRequest,
} from '@/lib/bot/external-request'
import { detectHandoffIntent, executeHandoff, isHandoffAvailableNow, logHandoffUnavailable } from '@/lib/bot/handoff'
import { broadcastToWorkspace } from '@/lib/realtime/broadcast'
import { parseMarkers } from '@/lib/bot/parse-markers'
import { createBookingRevenueEntry } from '@/lib/revenue/cycle'
import {
  trackMessageReceived,
  trackBotResponded,
  trackAppointmentBookedByBot,
  trackHandoffTriggered,
  trackUnsupportedMessageReceived,
  trackWaitlistPatientAddedByBot,
} from '@/lib/analytics/posthog-server'
import type { Database, ExternalRequestSummary } from '@/types/database'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'
import { recordClaudeCost, recordWhatsappConversation } from '@/lib/costs/record'
import { missingOutsourcedFields } from '@/lib/outsourced/config'
import {
  alreadyPendingMessage,
  missingDataMessage,
  REQUEST_FAILED_MESSAGE,
  requestedMessage,
} from '@/lib/outsourced/messages'
import { notifyOutsourcedIssue } from '@/lib/outsourced/notify'
import { requestExternalConfirmation } from '@/lib/outsourced/request'

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

// Dados da coleta por unidade já validados: o que veio nesta resposta, ou o que
// o paciente já tinha salvo. Motivo e preferência valem só para esta resposta
// (ficam na consulta / na solicitação, não no paciente).
interface IntakeSnapshot {
  cardNumber: string | null
  cpf: string | null
  email: string | null
  reason: string | null
  preference: string | null
}

const MAX_INTAKE_TEXT = 200

async function collectIntakeData(input: {
  supabase: SupabaseAdmin
  markers: ReturnType<typeof parseMarkers>
  patient: { id: string } | null
  collected: ReadonlySet<IntakeField>
  conversationId: string
}): Promise<IntakeSnapshot> {
  const { supabase, markers, patient, collected, conversationId } = input
  const empty: IntakeSnapshot = { cardNumber: null, cpf: null, email: null, reason: null, preference: null }
  // Account sem nenhuma unidade configurada: nenhuma query a mais.
  if (collected.size === 0 || !patient) return empty

  const parse = (field: IntakeField, raw: string | null, fn: (v: string) => string | null): string | null => {
    if (!collected.has(field) || !raw) return null
    const value = fn(raw)
    if (!value) console.warn(`[intake] valor rejeitado field=${field} conversation=${conversationId}`)
    return value
  }
  const card = parse('insurance', markers.cardNumber, parseCardNumber)
  const cpf = parse('cpf', markers.cpf, parseCpf)
  const email = parse('email', markers.email, parseEmail)
  const reason = parse('reason', markers.reason, (v) => sanitizeShortText(v, MAX_INTAKE_TEXT))
  const preference = parse('preference', markers.preference, (v) => sanitizeShortText(v, MAX_INTAKE_TEXT))

  const { data: stored } = await supabase
    .from('patients')
    .select('cpf, email, insurance_card_number')
    .eq('id', patient.id)
    .maybeSingle()

  const update: Database['public']['Tables']['patients']['Update'] = {}
  if (card && card !== stored?.insurance_card_number) update.insurance_card_number = card
  if (cpf && cpf !== stored?.cpf) update.cpf = cpf
  if (email && email !== stored?.email) update.email = email
  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('patients').update(update).eq('id', patient.id)
    if (error) console.error(`[intake] gravação do paciente falhou conversation=${conversationId}`)
  }

  return {
    cardNumber: card ?? stored?.insurance_card_number ?? null,
    cpf: cpf ?? stored?.cpf ?? null,
    email: email ?? stored?.email ?? null,
    reason,
    preference,
  }
}

// O bot conversa e agenda 24/7 — nunca fica "fechado". Só o handoff para um
// humano tem horário próprio (handoff_hours), checado no passo 10.
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
  const [allUnits, { data: account }] = await Promise.all([
    getAccountUnits(accountId),
    supabase.from('accounts').select('name, modules').eq('id', accountId).single(),
  ])
  if (allUnits.length === 0) {
    console.warn(`account ${accountId} sem unidades ativas — Clara não tem onde agendar`)
    return
  }
  const accountName = account?.name ?? 'nossa clínica'
  const accountModules = (account as { modules?: unknown })?.modules
  const waitlistEnabled = Array.isArray(accountModules) && accountModules.includes('waitlist')
  const units = allUnits
  const allUnitById = new Map(units.map((u) => [u.id, u]))
  const multiUnit = units.length > 1
  // Dados que alguma unidade coleta (vazio = account no padrão).
  const collectedFieldsAnywhere = new Set(units.flatMap((u) => u.botSettings?.intakeFields ?? []))
  const isExternal = (unitId: string | null | undefined) =>
    !!unitId && allUnitById.get(unitId)?.botSettings?.schedulingMode === 'external'

  // 2. Paciente (por account).
  const patient = await getOrCreatePatient(supabase, accountId, patientPhone)

  // 3. Conversa deste paciente (uma por account+telefone). Numa conta de uma
  // unidade só, a conversa já nasce ligada a ela e aparece no /conversa daquela
  // clínica desde já; com várias, workspace_id fica NULL até a Clara confirmar
  // a unidade (passo 7.5).
  const singleUnitId = units.length === 1 ? units[0].id : null
  const conversation = await getOrCreateConversation(
    supabase,
    accountId,
    patient?.id,
    patientPhone,
    singleUnitId
  )

  // 3.1 Unidade "corrente" da conversa — a que o paciente já mencionou (marcador
  // UNIDADE_ID numa resposta anterior). É só uma DICA: a Clara continua vendo
  // todas as unidades e todos os horários, e o paciente pode trocar de unidade
  // ou pedir as opções a qualquer momento. A garantia dura vem da revalidação
  // no agendamento (isSlotAvailable na unidade escolhida).
  const currentUnitId =
    conversation.workspace_id && allUnitById.has(conversation.workspace_id) ? conversation.workspace_id : null

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
    await notifyHumanNeeded(conversation, patient)
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
  const history = chronological[0]?.role === 'assistant' ? chronological.slice(1) : chronological

  const isFirstMessage = (history?.length ?? 0) <= 1

  // 6. Horários livres reais por unidade (availability_rules + Google Calendar).
  // Unidade com agenda externa não tem horários na MedScale (nem precisa de expediente).
  const slotsPerUnit = await Promise.all(
    units.map((u) => (isExternal(u.id) ? Promise.resolve({}) : collectFreeSlots(u.id)))
  )
  const freeSlotsByUnit: Record<string, Record<string, string[]>> = {}
  units.forEach((u, i) => {
    freeSlotsByUnit[u.id] = slotsPerUnit[i]
  })

  // 6.5. Consultas futuras já agendadas deste paciente — todas as unidades.
  const contextNow = new Date()
  const { data: upcomingRows, error: upcomingError } = patient
    ? await supabase
        .from('appointments')
        .select('id, scheduled_at, workspace_id, status')
        .eq('account_id', accountId)
        .eq('patient_id', patient.id)
        .in('status', ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS])
        .gte('scheduled_at', contextNow.toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5)
    : { data: null, error: null }

  const upcomingAppointments = (upcomingRows ?? []).map((row) => {
    const zoned = new TZDate(new Date(row.scheduled_at), 'America/Sao_Paulo')
    const dateLabel = zoned.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const timeLabel = format(zoned, 'HH:mm')
    const unitName = row.workspace_id ? allUnitById.get(row.workspace_id)?.name : null
    if (row.status === PENDING_EXTERNAL_STATUS) {
      return { id: row.id, label: `${dateLabel} às ${timeLabel} — ${unitName ?? 'unidade'} — AGUARDANDO CONFIRMAÇÃO DA CLÍNICA` }
    }
    return {
      id: row.id,
      label: `${dateLabel} às ${timeLabel}${multiUnit && unitName ? ` — ${unitName}` : ''} — status: ${row.status === 'confirmado' ? 'confirmada' : 'agendada'}`,
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

  // 6.7. Convênios aceitos — os ativos cadastrados em Convênios.
  const { data: insurerRows, error: insurersError } = await supabase
    .from('health_insurers')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  const insurancePlans = (insurerRows ?? []).map((i) => i.name)

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
      isOutsourced: u.isOutsourced,
      botSettings: u.botSettings,
    })),
    freeSlotsByUnit,
    procedureCatalogByUnit,
    insurancePlans,
    insurers: insurerRows ?? [],
    isFirstMessage,
    upcomingAppointments,
    upcomingAppointmentsAvailable: !upcomingError,
    now: contextNow,
    currentUnitName: currentUnitId ? (allUnitById.get(currentUnitId)?.name ?? null) : null,
    waitlistEnabled,
  })

  // Só o turno do paciente vai delimitado — a fala do próprio bot não é
  // conteúdo não confiável. As linhas em `messages` no banco seguem cruas.
  const claudeMessages = (history ?? []).map((m) => {
    const timestamp = m.sent_at && !Number.isNaN(new Date(m.sent_at).getTime())
      ? `[Mensagem enviada em ${new Date(m.sent_at).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
        })} (America/Sao_Paulo)]\n`
      : '[Mensagem sem data registrada; referências como "amanhã" não determinam a data atual.]\n'
    return {
      role: m.role as 'user' | 'assistant',
      content: timestamp + (m.role === 'user' ? wrapPatientMessage(m.content) : m.content),
    }
  })

  // Sinais de injection nas últimas 10 mensagens do paciente. Roda sobre o
  // histórico que já está em memória: zero query nova, zero coluna nova.
  const injectionSignals = (history ?? [])
    .filter((m) => m.role === 'user')
    .slice(-10)
    .map((m) => detectInjectionAttempt(m.content))
    .filter((s): s is InjectionSignal => s !== null)

  // LGPD: só não-PII no log. O scrub do Sentry (lib/observability/sentry-scrub.ts)
  // redige APENAS telefone — qualquer texto de paciente em console.* viraria
  // breadcrumb e vazaria intacto. O texto bruto fica em `messages`, sob RLS.
  if (injectionSignals.length > 0) {
    console.warn(
      `[security] sinais=${injectionSignals.length} padrões=${injectionSignals.map((s) => s.pattern).join(',')} ` +
        `conversation=${conversation.id}`
    )
  }

  const BOT_MODEL = 'claude-sonnet-4-5'
  let responseText: string | null = null
  for (let attempt = 1; attempt <= 2 && responseText === null; attempt++) {
    const response = await anthropic.messages.create({
      model: BOT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    })

    // Dentro do laço: a segunda tentativa é cobrada igual à primeira, e é
    // justamente o retry repetido que denuncia bot mal configurado no painel.
    await recordClaudeCost({
      ctx: { accountId, workspaceId: conversation.workspace_id },
      provider: 'claude_agendamento',
      model: BOT_MODEL,
      usage: response.usage,
      relatedId: conversation.id,
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

  // Fail-safe financeiro: a resposta que promete um desconto que não está
  // configurado em lugar nenhum não chega ao paciente (decisão 9). O
  // processamento de marcadores segue normal logo abaixo — um agendamento
  // legítimo na mesma resposta é criado do mesmo jeito (decisão 10). Esta
  // camada nunca decide se uma consulta é legítima.
  const discountFlagged = containsUnconfiguredDiscount(rawMessage, botConfig)
  if (discountFlagged) {
    console.warn(`[security] resposta com desconto não configurado descartada conversation=${conversation.id}`)
  }

  // Nome rejeitado não atualiza `patients.full_name` e não falha o fluxo. Não
  // vai para handoff_logs: um nome rejeitado não dispara handoff, então não há
  // linha onde gravar (decisão 7a). A mensagem original já está em `messages`,
  // sob RLS, e é de lá que a revisão reconstrói o caso — por isso o log leva só
  // o tamanho, nunca o valor.
  const patientName = markers.patientName ? sanitizePatientName(markers.patientName) : null
  if (markers.patientName && !patientName) {
    console.warn(
      `[security] NOME_PACIENTE rejeitado conversation=${conversation.id} tamanho=${markers.patientName.length}`
    )
  }
  if (patient && patientName && patientName !== patient.full_name) {
    await supabase.from('patients').update({ full_name: patientName }).eq('id', patient.id)
    patient.full_name = patientName
  }

  // Nascimento (só unidades terceirizadas): data inválida é descartada sem
  // falhar o fluxo. O log leva só o id da conversa — nunca o valor (LGPD).
  // DATA_NASCIMENTO (AAAA-MM-DD) é o formato da coleta por unidade; o
  // NASCIMENTO_PACIENTE (DD/MM/AAAA) segue valendo para as terceirizadas.
  const birthDate =
    (markers.patientBirthDate ? parseBirthDate(markers.patientBirthDate, contextNow) : null) ??
    (markers.isoBirthDate ? parseIsoBirthDate(markers.isoBirthDate, contextNow) : null)
  if ((markers.patientBirthDate || markers.isoBirthDate) && !birthDate) {
    console.warn(`[security] data de nascimento rejeitada conversation=${conversation.id}`)
  }
  if (patient && birthDate && birthDate !== patient.birth_date) {
    await supabase.from('patients').update({ birth_date: birthDate }).eq('id', patient.id)
    patient.birth_date = birthDate
  }

  // Dados da coleta por unidade (workspaces.intake_fields). Só grava o que
  // alguma unidade da account pede — CPF nunca é guardado sem unidade com 'cpf'.
  // Inválido é descartado; o log leva só o nome do campo (LGPD).
  const intake = await collectIntakeData({
    supabase,
    markers,
    patient,
    collected: collectedFieldsAnywhere,
    conversationId: conversation.id,
  })

  // 7.5 Unidade corrente: a Clara emite UNIDADE_ID quando o paciente indica a
  // unidade. Grava na conversa (é o que faz o chat aparecer no /conversa
  // daquela clínica) e serve de DICA para as próximas mensagens — a Clara
  // continua vendo todas as unidades e o paciente pode trocar quando quiser.
  if (
    markers.unitId &&
    allUnitById.has(markers.unitId) &&
    conversation.workspace_id !== markers.unitId
  ) {
    await supabase.from('conversations').update({ workspace_id: markers.unitId }).eq('id', conversation.id)
    conversation.workspace_id = markers.unitId
  }

  // Para quem vai a notificação de handoff: se a unidade já é conhecida (conta
  // de uma unidade só, ou o paciente já a indicou), só ela é avisada; se ainda
  // não, avisa todas as unidades da conta para o pedido não ficar sem dono.
  const handoffNotifyIds = conversation.workspace_id ? [conversation.workspace_id] : units.map((u) => u.id)

  // 8. Executar agendamento/cancelamento confirmados ANTES de montar a resposta.
  let bookingFailed = false
  let unitRequired = false
  let cancellationFailed = false
  // Unidade terceirizada: mensagem fixa que substitui a do Claude, e se nada
  // foi solicitado à clínica (faltou dado, já havia pendente ou o pedido
  // falhou) — numa remarcação, aí a consulta antiga fica.
  let outsourcedMessage: string | null = null
  let outsourcedNotRequested = false
  // Coleta por unidade: dados que faltam antes de agendar (unidade 'internal')
  // ou de transferir (unidade 'external'). null = nada recusado.
  let intakeMissing: IntakeField[] | null = null

  // A Clara nunca marca consulta em unidade com agenda externa: o prompt
  // proíbe e aqui o marcador é descartado. O log leva só o fato e a unidade.
  const requestedBookingUnitId =
    (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
    currentUnitId ??
    (units.length === 1 ? units[0].id : null)
  const externalBookingBlocked = markers.confirmedDate !== null && isExternal(requestedBookingUnitId)
  if (externalBookingBlocked) {
    console.warn(`[intake] AGENDAMENTO_CONFIRMADO ignorado em unidade externa workspace=${requestedBookingUnitId}`)
  }
  const confirmedDate = externalBookingBlocked ? null : markers.confirmedDate

  const insuranceChoice = markers.insuranceChoice
  const selectedInsurer = insuranceChoice && insuranceChoice !== 'PARTICULAR'
    ? (insurerRows ?? []).find((i) => i.id.toLowerCase() === insuranceChoice.toLowerCase()) ?? null
    : null
  const insuranceNeedsClarification = confirmedDate !== null && (
    Boolean(insurersError) || (insuranceChoice === null
      ? (insurerRows ?? []).length > 0 || !botConfig.acceptsPrivate
      : insuranceChoice === 'PARTICULAR' ? !botConfig.acceptsPrivate : !selectedInsurer)
  )
  // Unidade envolvida nesta troca (agendamento, ou contexto atual da conversa) —
  // usada também pelo handoff mais abaixo.
  let resolvedUnitId: string | null = conversation.workspace_id ?? (units.length === 1 ? units[0].id : null)

  if (confirmedDate && !insuranceNeedsClarification) {
    const bookingUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
      currentUnitId ??
      (units.length === 1 ? units[0].id : null)

    if (!bookingUnitId) {
      // A Clara confirmou um horário sem dizer a unidade (account com várias) —
      // não dá pra agendar; pede a unidade em vez de confirmar algo falso.
      unitRequired = true
    } else {
      resolvedUnitId = bookingUnitId
      const scheduledAt = confirmedDate
      const durationMin = 30

      const unitCatalog = procedureCatalogByUnit[bookingUnitId] ?? []
      const resolvedProcedure = !selectedInsurer && markers.procedureId
        ? unitCatalog.find((p) => p.id === markers.procedureId) ??
          flatCatalog.find((p) => p.id === markers.procedureId) ??
          null
        : null
      const snapshotPrice = resolvedProcedure?.price ?? null

      const bookingUnit = allUnitById.get(bookingUnitId)
      // Unidade 'internal' com dados a coletar: o backend confere antes de
      // agendar, sem confiar só no prompt.
      const bookingIntakeFields = bookingUnit?.botSettings?.intakeFields ?? []
      const bookingMissing = bookingIntakeFields.length > 0
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
      } else if (bookingUnit?.isOutsourced && bookingUnit.externalClinicPhone) {
        // Unidade terceirizada: a Clara não agenda — pede o horário à clínica
        // parceira e o paciente recebe uma mensagem fixa (o Claude não promete nada).
        const fullName = patient?.full_name ?? null
        const patientBirthDate = patient?.birth_date ?? null
        const missing = missingOutsourcedFields({
          fullName,
          birthDate: patientBirthDate,
          // Mesma regra do fluxo nativo: chegar aqui já significa convênio
          // resolvido — inclusive sem CONVENIO_ID numa clínica sem convênios
          // que aceita particular (vira particular, insurer null).
          insuranceChosen: !insuranceNeedsClarification,
        })
        // `missing` vazio já garante paciente, nome e nascimento — os outros
        // testes só estreitam os tipos e nunca disparam com `missing` vazio.
        if (missing.length > 0 || !patient || !fullName || !patientBirthDate) {
          outsourcedMessage = missingDataMessage(missing, bookingUnit.name)
          outsourcedNotRequested = true
        } else if (!(await isSlotAvailable(bookingUnitId, scheduledAt, durationMin).catch(() => true))) {
          console.warn(`Slot ${markers.confirmedSlot} não está mais disponível (unidade ${bookingUnitId}) — solicitação não enviada.`)
          bookingFailed = true
        } else {
          const result = await requestExternalConfirmation({
            supabase,
            accountId,
            accountName,
            unit: { id: bookingUnitId, name: bookingUnit.name, externalClinicPhone: bookingUnit.externalClinicPhone },
            patient: { id: patient.id, fullName, birthDate: patientBirthDate },
            patientPhone,
            conversationId: conversation.id,
            scheduledAt,
            durationMin,
            insurer: selectedInsurer,
            procedure: resolvedProcedure,
            replacingAppointmentId: markers.cancelledAppointmentId,
            phoneNumberId: botConfig.phoneNumberId,
            metaToken: botConfig.metaToken ? decryptToken(botConfig.metaToken) : null,
          })
          outsourcedNotRequested = result.kind !== 'requested'
          outsourcedMessage =
            result.kind === 'requested'
              ? requestedMessage({ scheduledAt, unitName: bookingUnit.name })
              : result.kind === 'already_pending'
                ? alreadyPendingMessage(bookingUnit.name)
                : REQUEST_FAILED_MESSAGE
        }
      } else {
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
              ...(selectedInsurer ? {
                billing_type: 'convenio' as const,
                insurer_id: selectedInsurer.id,
                health_plan: selectedInsurer.name,
              } : {}),
              ...(intake.reason && bookingIntakeFields.includes('reason') ? { reason: intake.reason } : {}),
            })
            .select()
            .single()

          if (appt) {
            await supabase
              .from('conversations')
              .update({ appointment_id: appt.id, workspace_id: bookingUnitId })
              .eq('id', conversation.id)

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
  }

  // Cancelamento confirmado — casa por id (copiado do system prompt) + paciente.
  // Remarcação que não agendou (dado faltando, unidade externa) mantém a antiga.
  if (
    markers.cancelledAppointmentId &&
    patient &&
    !insuranceNeedsClarification &&
    !outsourcedNotRequested &&
    !externalBookingBlocked &&
    intakeMissing === null
  ) {
    const apptId = markers.cancelledAppointmentId
    const { data: apptToCancel } = await supabase
      .from('appointments')
      .select('id, gcal_event_id, workspace_id')
      .eq('id', apptId)
      .eq('account_id', accountId)
      .eq('patient_id', patient.id)
      .in('status', ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS])
      .maybeSingle()

    if (apptToCancel) {
      const outsourced = allUnitById.get(apptToCancel.workspace_id ?? '')?.isOutsourced === true
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
    } else {
      console.warn(`Cancelamento (id ${apptId}) não encontrou consulta para paciente ${patient.id} na account ${accountId}.`)
      cancellationFailed = true
    }
  }

  // Lista de espera — a Clara emite LISTA_ESPERA quando o paciente, sem vaga
  // no dia que queria, opta por ser avisado em vez de escolher outro horário.
  // Nunca junto de um agendamento confirmado; ignorado se o módulo waitlist
  // não estiver ativo na account.
  if (markers.waitlistDesired && waitlistEnabled && !markers.confirmedDate && patient) {
    const waitlistUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
      currentUnitId ??
      (units.length === 1 ? units[0].id : null)

    if (waitlistUnitId) {
      const { data: existing } = await supabase
        .from('waitlist')
        .select('id')
        .eq('workspace_id', waitlistUnitId)
        .eq('patient_phone', patientPhone)
        .eq('desired_date', markers.waitlistDesired.date)
        .eq('status', 'waiting')
        .maybeSingle()

      if (existing) {
        await supabase
          .from('waitlist')
          .update({
            patient_id: patient.id,
            patient_name: patient.full_name ?? 'Paciente',
            desired_time: markers.waitlistDesired.time,
          })
          .eq('id', existing.id)
      } else {
        const { error: waitlistError } = await supabase.from('waitlist').insert({
          workspace_id: waitlistUnitId,
          account_id: accountId,
          patient_id: patient.id,
          patient_name: patient.full_name ?? 'Paciente',
          patient_phone: patientPhone,
          desired_date: markers.waitlistDesired.date,
          desired_time: markers.waitlistDesired.time,
          source: 'bot',
          status: 'waiting',
        })
        if (waitlistError) {
          console.error('waitlist insert (bot) falhou', waitlistError)
        } else {
          await trackWaitlistPatientAddedByBot(accountId, {
            workspace_id: waitlistUnitId,
            account_id: accountId,
          })
        }
      }
    }
  }

  // 8.5 Solicitação de agendamento (unidade com agenda externa). Só vale numa
  // unidade 'external' e com todos os dados que ela coleta; senão o marcador é
  // descartado. Os logs levam só metadados (campos faltantes, unidade).
  let externalRequest: { unitId: string; unitName: string; summary: ExternalRequestSummary } | null = null
  let externalRequestUnitRequired = false
  if (markers.schedulingRequested && !discountFlagged) {
    const requestUnitId =
      (markers.unitId && allUnitById.has(markers.unitId) ? markers.unitId : null) ??
      conversation.workspace_id ??
      (units.length === 1 ? units[0].id : null)
    const requestUnit = requestUnitId ? allUnitById.get(requestUnitId) : undefined

    if (!requestUnit) {
      console.warn(`[intake] SOLICITACAO_AGENDAMENTO sem unidade conversation=${conversation.id}`)
      externalRequestUnitRequired = multiUnit
    } else if (requestUnit.botSettings?.schedulingMode !== 'external') {
      console.warn(`[intake] SOLICITACAO_AGENDAMENTO ignorado em unidade internal workspace=${requestUnit.id}`)
    } else {
      const fields = requestUnit.botSettings.intakeFields
      const insurers = insurerRows ?? []
      const particular =
        botConfig.acceptsPrivate &&
        (insuranceChoice === 'PARTICULAR' || (insuranceChoice === null && insurers.length === 0))
      const missing = missingIntakeFields(fields, {
        fullName: patient?.full_name ?? null,
        birthDate: patient?.birth_date ?? null,
        insuranceResolved: !insurersError && (particular || !!selectedInsurer),
        particular,
        cardNumber: intake.cardNumber,
        cpf: intake.cpf,
        email: intake.email,
        reason: intake.reason,
        preference: intake.preference,
      })

      if (missing.length > 0) {
        console.warn(
          `[intake] missing_fields=${missing.join(',')} trigger_reason=${EXTERNAL_REQUEST_REASON} workspace=${requestUnit.id}`
        )
        intakeMissing = missing
      } else {
        const summary: ExternalRequestSummary = {
          workspace_id: requestUnit.id,
          phone: `+${patientPhone.replace(/\D/g, '')}`,
        }
        if (fields.includes('full_name')) summary.full_name = patient!.full_name
        if (fields.includes('birth_date')) summary.birth_date = patient!.birth_date!
        if (fields.includes('insurance')) {
          summary.particular = particular
          if (!particular && selectedInsurer) {
            summary.insurance = {
              convenio_id: selectedInsurer.id,
              name: selectedInsurer.name,
              card_number: intake.cardNumber,
            }
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

  const phoneNumberId = botConfig.phoneNumberId
  const metaToken = botConfig.metaToken ? decryptToken(botConfig.metaToken) : null

  const lastAssistantContent = [...(history ?? [])].reverse().find((m) => m.role === 'assistant')?.content

  // 9. Handoff — a unidade de contato/horário é a da conversa (ou a única).
  if (externalRequest) resolvedUnitId = externalRequest.unitId
  const handoffUnitId = resolvedUnitId ?? units[0].id
  const handoffUnit = allUnitById.get(handoffUnitId)
  // Desconto não lastreado força o handoff direto — não depende de acumular
  // sinais, porque a resposta já foi descartada e o paciente ficaria sem
  // resposta nenhuma.
  const handoffCheck = discountFlagged
    ? { needed: true, reason: 'injection_suspected' as const }
    : detectHandoffIntent(cleanedMessage, message, injectionSignals.length)
  // A solicitação de agendamento tem handoff próprio (passo 13), com resumo.
  const canAttemptHandoff = !externalRequest && handoffCheck.needed && phoneNumberId && metaToken

  console.log(
    `[handoff] needed=${handoffCheck.needed} reason=${handoffCheck.reason ?? '-'} ` +
      `unit=${handoffUnitId} hasNumber=${Boolean(handoffUnit?.handoffNumber)} ` +
      `hasPhoneId=${Boolean(phoneNumberId)} hasToken=${Boolean(metaToken)} canAttempt=${Boolean(canAttemptHandoff)}`
  )

  // 10. Mensagem final para o paciente. Se o agendamento/cancelamento não bateu
  // no banco, a resposta do Claude é descartada e substituída por algo honesto.
  let finalMessage: string
  if (externalBookingBlocked) {
    finalMessage = EXTERNAL_BOOKING_BLOCKED_MESSAGE
  } else if (insuranceNeedsClarification) {
    finalMessage = botConfig.acceptsPrivate
      ? 'Antes de confirmar o agendamento, pode confirmar qual é o seu convênio ou se prefere atendimento particular?'
      : 'Antes de confirmar o agendamento, pode confirmar qual é o seu convênio? A equipe pode ajudar a verificar o atendimento.'
  } else if (unitRequired || externalRequestUnitRequired) {
    finalMessage = UNIT_REQUIRED_MESSAGE
  } else if (intakeMissing) {
    finalMessage = intakeMissingMessage(intakeMissing)
  } else if (bookingFailed) {
    finalMessage = BOOKING_FAILED_MESSAGE
  } else if (outsourcedMessage) {
    finalMessage = outsourcedMessage
  } else if (cancellationFailed) {
    finalMessage = CANCELLATION_FAILED_MESSAGE
  } else if (discountFlagged) {
    // Vazia de propósito: o paciente recebe só a mensagem genérica de
    // transição que o executeHandoff envia. Nada indica que houve detecção.
    finalMessage = ''
  } else {
    finalMessage = markers.messageForPatient
  }
  let realHandoff = false

  // Solicitação válida: mensagem fixa (o Claude não promete horário). Dentro do
  // horário de handoff a conversa vai para a equipe; fora, fica pendente e a
  // Clara segue disponível.
  let externalRequestInHours = false
  if (externalRequest) {
    externalRequestInHours = phoneNumberId && metaToken
      ? await isHandoffAvailableNow(externalRequest.unitId, accountId).catch(() => true)
      : false
    finalMessage = externalRequestInHours
      ? externalRequestInHoursMessage(externalRequest.unitName)
      : externalRequestOutOfHoursMessage(externalRequest.unitName)
  }

  if (canAttemptHandoff) {
    const handoffAvailable = await isHandoffAvailableNow(handoffUnitId, accountId).catch(() => true)
    console.log(`[handoff] canAttempt=true handoffAvailableNow=${handoffAvailable}`)
    if (handoffAvailable) {
      realHandoff = true
    } else {
      finalMessage = finalMessage ? `${finalMessage}\n\n${botConfig.outOfHoursMessage}` : botConfig.outOfHoursMessage
    }
  }

  // 12. Disjuntor de loop — resposta idêntica à última do próprio bot.
  if (finalMessage && !realHandoff && !externalRequest && finalMessage === lastAssistantContent) {
    console.log('[handoff] disjuntor de loop acionado (resposta repetida) — escalando para humano')
    const escalationMessage = handoffUnit?.handoffNumber
      ? `Desculpa, não estou conseguindo resolver isso sozinha. Vou te passar para a equipe de ${accountName}: ${handoffUnit.handoffNumber}`
      : 'Desculpa, não estou conseguindo resolver isso sozinha. Já avisei a equipe sobre sua solicitação — alguém vai te chamar em breve.'

    await supabase.from('messages').insert({ conversation_id: conversation.id, role: 'assistant', content: escalationMessage })
    // Garante que a conversa fique visível no /conversa da clínica que vai
    // atender (handoffUnitId é a unidade da conversa, ou a 1ª da conta se o
    // paciente nem chegou a escolher).
    await supabase
      .from('conversations')
      .update({
        status: 'handoff',
        bot_paused: true,
        resolved_at: new Date().toISOString(),
        workspace_id: handoffUnitId,
      })
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
      await Promise.all(
        handoffNotifyIds.map((wid) =>
          sendHandoffPush(wid, {
            title: '🔔 Atendimento solicitado',
            body: `${patient?.full_name ?? 'Paciente'} precisa de atendimento humano`,
            url: `/bot?c=${conversation.id}`,
          })
        )
      )
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

    if (externalRequest && externalRequestInHours) {
      console.log(`[handoff] solicitação de agendamento — transferência real workspace=${externalRequest.unitId}`)
      await closeSupersededExternalRequests(conversation.id)
      await executeHandoff({
        workspaceId: externalRequest.unitId,
        accountId,
        conversationId: conversation.id,
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
        notifyWorkspaceIds: handoffNotifyIds,
        flaggedContent: discountFlagged ? rawMessage : null,
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

  // Fora do horário (ou sem WhatsApp configurado): a solicitação não se perde —
  // fica pendente no painel e a equipe é avisada. O bot não pausa.
  if (externalRequest && !externalRequestInHours) {
    await recordPendingExternalRequest({
      accountId,
      workspaceId: externalRequest.unitId,
      unitName: externalRequest.unitName,
      conversationId: conversation.id,
      patientPhone,
      handoffNumber: handoffUnit?.handoffNumber ?? null,
      summary: externalRequest.summary,
    })
  }
}
