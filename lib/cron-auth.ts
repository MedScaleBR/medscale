import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

// Segredo compartilhado dos jobs internos: rotas em app/api/cron/* (disparadas
// pelo Supabase pg_cron via pg_net — ver supabase/cron.sql) e as rotas do
// pipeline de transcrição chamadas por trigger_transcription_* (schema.sql).
//
// Antes cada rota comparava `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``
// direto: com a variável ausente isso virava `!== 'Bearer undefined'` e um
// `Authorization: Bearer undefined` autenticava qualquer chamador. Aqui a
// ausência/curteza do segredo é tratada como "nega tudo" (500), e a comparação
// é feita em tempo constante.

const MIN_LEN = 16

function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < MIN_LEN) return null
  return secret
}

// Chamado no boot (instrumentation.ts) só para logar cedo uma configuração
// inválida — não derruba o processo para não quebrar build/preview da Vercel.
export function assertCronSecretConfigured(): void {
  if (!getCronSecret()) {
    console.error(
      `[cron-auth] CRON_SECRET ausente ou com menos de ${MIN_LEN} caracteres — ` +
        'todas as rotas de cron e do pipeline de transcrição vão responder 500 até ser corrigido.'
    )
  }
}

// Retorna null quando o chamador está autorizado; caso contrário devolve a
// resposta (401 header inválido / 500 servidor sem segredo) que a rota deve
// retornar de imediato.
export function requireCronAuth(req: { headers: { get(name: string): string | null } }): NextResponse | null {
  const secret = getCronSecret()
  if (!secret) {
    console.error('[cron-auth] requisição recusada: CRON_SECRET não configurado')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(req.headers.get('authorization') ?? '')

  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
