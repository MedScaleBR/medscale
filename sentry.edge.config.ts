import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent, scrubSentryBreadcrumb } from '@/lib/observability/sentry-scrub'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  // Redige telefone de paciente (LGPD) de erros e breadcrumbs antes do envio.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
})
