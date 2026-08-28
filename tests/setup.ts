import { vi, beforeEach } from 'vitest'

// Suprimir logs de console nos testes (ruído desnecessário — vários caminhos
// testados aqui logam warn/error de propósito).
vi.spyOn(console, 'error').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})

// Variáveis de ambiente que os módulos leem no import (createAdminClient,
// SDKs) — valores falsos, nenhuma chamada real sai daqui.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
process.env.OPENAI_API_KEY = 'sk-openai-test'
process.env.CRON_SECRET = 'cron-secret-test'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
// Sem key de PostHog nos testes — os helpers de analytics viram no-op e
// nenhum evento é emitido.
delete process.env.NEXT_PUBLIC_POSTHOG_KEY

beforeEach(() => {
  vi.clearAllMocks()
})
