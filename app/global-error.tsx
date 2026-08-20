'use client'

import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    import('@sentry/nextjs').then(({ captureException }) => captureException(error))
  }, [error])

  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen items-center justify-center bg-[var(--navy-dark,#0F1E45)] text-white">
        <div className="text-center">
          <h1 className="text-lg font-medium">Algo deu errado.</h1>
          <p className="mt-1 text-sm text-white/70">Tente recarregar a página.</p>
        </div>
      </body>
    </html>
  )
}
