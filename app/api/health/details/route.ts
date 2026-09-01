import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkDatabase, checkFinanceAgent, checkLlm, checkMaria } from '@/lib/health/checks'

// Panorama completo de todos os checks — consulta manual de diagnostico. NÃO
// entra no UptimeRobot. Diferente de /api/health (publico), este expoe erro de
// banco cru, contagem global de bots ativos e presenca de env vars, entao e
// restrito a admin interno da MedScale.
//
// SEMPRE retorna HTTP 200 (quando autorizado): o objetivo é informar, não
// alertar.

// Nunca cachear — sempre reflete o estado atual.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_medscale_admin')
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [database, maria] = await Promise.all([checkDatabase(), checkMaria()])

  const checks = {
    database,
    llm: checkLlm(),
    maria,
    finance_agent: checkFinanceAgent(),
  }

  return NextResponse.json({ timestamp: new Date().toISOString(), checks })
}
