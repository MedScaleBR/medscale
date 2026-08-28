import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent, scrubSentryBreadcrumb } from '@/lib/observability/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    // Produto de clínica (LGPD): mascara tudo que aparece na tela no Replay —
    // explícito mesmo sendo o padrão, pra deixar a intenção registrada.
    integrations: [
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    // Redige telefone de paciente de mensagens de erro e breadcrumbs antes do
    // envio (ver lib/observability/sentry-scrub.ts).
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  })
}

// Necessário no App Router (Next 15.3+/16) pra instrumentar as navegações
// client-side — sem isto, transições de rota não geram transação de tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
