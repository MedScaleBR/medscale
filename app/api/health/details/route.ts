import { NextResponse } from 'next/server'
import { checkDatabase, checkFinanceAgent, checkLlm, checkMaria } from '@/lib/health/checks'

// Panorama completo de todos os checks — consulta manual via browser/Postman
// quando quiser ver o estado geral do sistema. NÃO entra no UptimeRobot.
//
// SEMPRE retorna HTTP 200: o objetivo é informar, não alertar. Os checks de
// Maria e agente financeiro entram aqui (e não em /api/health) porque zero
// workspaces ativas ou o módulo financeiro desligado podem ser intencionais.

// Nunca cachear — sempre reflete o estado atual.
export const dynamic = 'force-dynamic'

export async function GET() {
  const [database, maria] = await Promise.all([checkDatabase(), checkMaria()])

  const checks = {
    database,
    llm: checkLlm(),
    maria,
    finance_agent: checkFinanceAgent(),
  }

  return NextResponse.json({ timestamp: new Date().toISOString(), checks })
}
