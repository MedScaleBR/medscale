import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  /* config options here */
  // A rota "/" (app/route.ts) lê medscale-site/index.html do disco em vez de
  // importá-lo — o rastreamento de arquivos do Next (@vercel/nft) não segue
  // fs.readFile com caminho montado em runtime, então sem isto o build da
  // Vercel não inclui a pasta na função serverless e dá ENOENT em produção.
  outputFileTracingIncludes: {
    '/': ['./medscale-site/**/*'],
  },
}

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : nextConfig
