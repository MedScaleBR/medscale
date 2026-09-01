export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Loga cedo se o segredo dos jobs internos estiver ausente/curto — as
    // rotas de cron e do pipeline de transcrição respondem 500 nesse estado
    // (ver lib/cron-auth.ts), nunca mais aceitam "Bearer undefined".
    const { assertCronSecretConfigured } = await import('./lib/cron-auth')
    assertCronSecretConfigured()
  }

  if (!process.env.SENTRY_DSN) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export async function onRequestError(...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>) {
  if (!process.env.SENTRY_DSN) return
  const { captureRequestError } = await import('@sentry/nextjs')
  captureRequestError(...args)
}
