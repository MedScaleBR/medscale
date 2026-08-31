import { PostHog } from 'posthog-node'
import type { BaseProps } from './posthog'

// Eventos de negócio disparados no server — ações assíncronas sem interação
// direta do browser: webhook do WhatsApp, pipeline de transcrição, crons,
// agente financeiro. Ações diretas do usuário ficam no client
// (lib/analytics/posthog.ts).
//
// Nunca logar conteúdo clínico ou dado pessoal de paciente: só metadados
// (contagens, durações, status, enums, datas ISO).

let client: PostHog | null = null

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
      // Funções serverless terminam abruptamente — não dá pra confiar no
      // flush em background. captureServer() usa captureImmediate (envia na
      // hora e aguarda), então o queue nem entra em jogo; flushAt:1 é só
      // salvaguarda caso algum capture() comum apareça depois.
      flushAt: 1,
    })
  }
  return client
}

type ServerEventProps = Record<string, unknown> & Partial<BaseProps>

// Captura síncrona-imediata (aguarda o envio) — analytics jamais pode
// derrubar uma request ou o pipeline, então engole qualquer erro.
export async function captureServer(params: {
  distinctId: string
  event: string
  properties?: ServerEventProps
}): Promise<void> {
  const ph = getClient()
  if (!ph) return
  try {
    await ph.captureImmediate({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    })
  } catch (err) {
    console.error(`[analytics] captureServer(${params.event}) falhou`, err)
  }
}

// Pacientes não são usuários — não cria person profile para eventos do bot.
const NO_PERSON = { $process_person_profile: false } as const

// --- Onboarding / integrações ----------------------------------------

export function trackBotWizardCompleted(
  distinctId: string,
  props: BaseProps & { number_source: 'own' | 'medscale' }
) {
  return captureServer({ distinctId, event: 'bot_wizard_completed', properties: props })
}

// Conexão Google é por account (uma para todas as unidades) — BaseProps relaxado.
export function trackGoogleCalendarConnected(distinctId: string, props: { account_id: string }) {
  return captureServer({ distinctId, event: 'google_calendar_connected', properties: props })
}

// --- Bot / Conversas -------------------------------------------------

export function trackMessageReceived(
  accountId: string,
  props: BaseProps & { is_first_message: boolean }
) {
  return captureServer({
    distinctId: accountId,
    event: 'message_received',
    properties: { ...props, ...NO_PERSON },
  })
}

export function trackBotResponded(accountId: string, props: BaseProps & { response_length: number }) {
  return captureServer({
    distinctId: accountId,
    event: 'bot_responded',
    properties: { ...props, ...NO_PERSON },
  })
}

export function trackAppointmentBookedByBot(
  accountId: string,
  props: BaseProps & { slot_datetime: string }
) {
  return captureServer({
    distinctId: accountId,
    event: 'appointment_booked_by_bot',
    properties: { ...props, ...NO_PERSON },
  })
}

export function trackHandoffTriggered(
  accountId: string,
  props: BaseProps & { trigger_reason: string; handoff_available: boolean }
) {
  return captureServer({
    distinctId: accountId,
    event: 'handoff_triggered',
    properties: { ...props, ...NO_PERSON },
  })
}

export function trackUnsupportedMessageReceived(
  accountId: string,
  props: BaseProps & { message_type: string }
) {
  return captureServer({
    distinctId: accountId,
    event: 'unsupported_message_received',
    properties: { ...props, ...NO_PERSON },
  })
}

// --- Agendamento (CRM) — ações assíncronas --------------------------

export function trackWaitlistPatientNotified(distinctId: string, props: BaseProps) {
  return captureServer({
    distinctId,
    event: 'waitlist_patient_notified',
    properties: { ...props, ...NO_PERSON },
  })
}

// --- Transcrições (pipeline) --------------------------------------

export function trackTranscriptionCompleted(
  distinctId: string,
  props: BaseProps & { duration_seconds: number }
) {
  return captureServer({ distinctId, event: 'transcription_completed', properties: props })
}

export function trackSoapGenerated(distinctId: string, props: BaseProps) {
  return captureServer({ distinctId, event: 'soap_generated', properties: props })
}

export function trackTranscriptionError(
  distinctId: string,
  props: BaseProps & { error_message: string; retry_count: number }
) {
  return captureServer({ distinctId, event: 'transcription_error', properties: props })
}

// --- Financeiro ------------------------------------------------

// Agente financeiro é por account (sem workspace) — BaseProps relaxado.
export function trackFinanceEntryCreatedViaWhatsApp(
  distinctId: string,
  props: { account_id: string; category: string | null; amount: number }
) {
  return captureServer({
    distinctId,
    event: 'finance_entry_created_via_whatsapp',
    properties: props,
  })
}
