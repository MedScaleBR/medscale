import posthog from 'posthog-js'

// Helper tipado para os eventos de negócio disparados no client (ações
// diretas do usuário — formulários, botões). Ações assíncronas (crons,
// webhooks, pipeline de transcrição) usam lib/analytics/posthog-server.ts.
//
// Regra: todo evento carrega workspace_id + account_id (BaseProps). A única
// exceção é finance_entry_created_via_whatsapp, que é do agente financeiro
// por account (sem workspace) e roda no server.

export type BaseProps = {
  workspace_id: string
  account_id: string
}

// Config única de init do PostHog — chamada tanto pelo PostHogProvider quanto
// pelo PostHogIdentify (efeitos de filho rodam antes dos de pai, então o
// Identify precisa poder garantir o init por conta própria). Idempotente.
export function initPostHog() {
  if (typeof window === 'undefined') return
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key || posthog.__loaded) return

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    capture_pageview: true,
    person_profiles: 'identified_only',
  })
}

// Captura só quando o PostHog já inicializou — sem key configurada (ex: dev
// local, testes) vira no-op silencioso.
function capture(event: string, properties: Record<string, unknown>) {
  if (typeof window === 'undefined' || !posthog.__loaded) return
  posthog.capture(event, properties)
}

// --- Onboarding e configuração -------------------------------------------

export function trackBotWizardStarted(props: BaseProps) {
  capture('bot_wizard_started', props)
}

export function trackAvailabilityRulesSaved(props: BaseProps & { days_configured: number }) {
  capture('availability_rules_saved', props)
}

// --- Agendamento (CRM) --------------------------------------------------

export function trackAppointmentCreatedManual(props: BaseProps) {
  capture('appointment_created_manual', { ...props, source: 'manual' })
}

export function trackAppointmentStatusChanged(
  props: BaseProps & { from_status: string; to_status: string }
) {
  capture('appointment_status_changed', props)
}

export function trackWaitlistPatientAdded(props: BaseProps) {
  capture('waitlist_patient_added', props)
}

// --- Bot / Conversas (controle manual) --------------------------------

export function trackBotPausedManually(props: BaseProps) {
  capture('bot_paused_manually', props)
}

export function trackBotResumed(props: BaseProps) {
  capture('bot_resumed', props)
}

// --- Transcrições ----------------------------------------------------

export function trackRecordingStarted(props: BaseProps) {
  capture('recording_started', props)
}

export function trackRecordingUploaded(
  props: BaseProps & { duration_seconds: number; file_size_mb: number }
) {
  capture('recording_uploaded', props)
}

export function trackTranscriptionSigned(props: BaseProps & { time_to_sign_minutes: number }) {
  capture('transcription_signed', props)
}

// --- Financeiro ----------------------------------------------------

export function trackRevenueEntryCreated(
  props: BaseProps & { type: 'confirmado' | 'previsto' | 'cancelado' }
) {
  capture('revenue_entry_created', props)
}
