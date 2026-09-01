import { NextResponse } from 'next/server'
import { checkDatabase, checkLlm } from '@/lib/health/checks'

// Health check público (sem autenticação) monitorado pelo UptimeRobot. O
// webhook do WhatsApp não serve pra isso — ele rejeita qualquer request sem
// assinatura HMAC válida da Meta.
//
// Só os checks CRÍTICOS: se qualquer um falhar, nenhum dos dois agentes que
// rodam pelo webhook funciona.
//   - banco caído              → nenhuma mensagem é processada
//   - ANTHROPIC_API_KEY ausente → nenhuma resposta é gerada
//
// HTTP 200 = tudo ok · HTTP 503 = alguma falha (o UptimeRobot abre incidente
// pelo status code). O panorama completo fica em /api/health/details.

// Nunca cachear — o UptimeRobot precisa do estado real a cada chamada.
export const dynamic = 'force-dynamic'

export async function GET() {
  const database = await checkDatabase()
  const llm = checkLlm()
  const ok = database.ok && llm.ok

  if (!ok) console.error('[health] check falhou', { database, llm })

  // Endpoint publico (UptimeRobot) — so o status code e booleans. Nada de
  // mensagens de erro do banco nem presenca de env vars na resposta.
  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      checks: { database: { ok: database.ok }, llm: { ok: llm.ok } },
    },
    { status: ok ? 200 : 503 },
  )
}
