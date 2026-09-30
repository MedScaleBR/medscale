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
    // Geração de lote TISS valida o XML contra os XSDs oficiais da ANS, lidos
    // do disco em runtime (lib/tiss/validate.ts) — mesmo caso do medscale-site.
    '/api/billing/batches': ['./lib/tiss/schemas/**/*'],
    '/api/cron/tiss-batches': ['./lib/tiss/schemas/**/*'],
  },
  // xmllint-wasm sobe um worker_thread com o libxml2 em WebAssembly a partir
  // de arquivos do próprio pacote (xmllint-node.js + xmllint.wasm) — precisa
  // ficar fora do bundle para esses caminhos continuarem válidos.
  serverExternalPackages: ['xmllint-wasm'],
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
