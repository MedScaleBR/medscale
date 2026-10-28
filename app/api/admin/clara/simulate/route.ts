import { NextRequest, NextResponse } from 'next/server'
import { requireMedscaleAdmin } from '@/lib/admin/require-admin'
import { createAdminClient } from '@/lib/supabase/server'
import {
  parseSimulationInput,
  runSimulation,
  SimulationError,
  SIMULATOR_RATE_LIMIT,
  SIMULATOR_RATE_WINDOW_SECONDS,
} from '@/lib/llm/simulate'

// Simulador da Clara — só a equipe MedScale. Nada é gravado além do custo da
// chamada ao Claude (cost_events, provider 'claude_simulador'), que também
// serve de contador do limite por usuário: funciona entre instâncias
// serverless sem tabela nova.
export const maxDuration = 60

async function recentSimulatorCalls(staffUserId: string): Promise<number> {
  const since = new Date(Date.now() - SIMULATOR_RATE_WINDOW_SECONDS * 1000).toISOString()
  const { count } = await createAdminClient()
    .from('cost_events')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'claude_simulador')
    .eq('metadata->>staff_user_id', staffUserId)
    .gte('created_at', since)
  return count ?? 0
}

export async function POST(req: NextRequest) {
  const auth = await requireMedscaleAdmin()
  if ('error' in auth) return auth.error
  const { user } = auth

  const parsed = parseSimulationInput(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  if ((await recentSimulatorCalls(user.id)) >= SIMULATOR_RATE_LIMIT) {
    return NextResponse.json(
      { error: `Limite de ${SIMULATOR_RATE_LIMIT} mensagens por minuto no simulador. Espere um pouco e tente de novo.` },
      { status: 429 }
    )
  }

  try {
    const result = await runSimulation(parsed.value, { staffUserId: user.id })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SimulationError) return NextResponse.json({ error: err.message }, { status: 400 })
    // Só metadados no log: o erro pode carregar trecho da conversa simulada.
    console.error(`[simulador] falhou account=${parsed.value.account_id} tipo=${err instanceof Error ? err.name : typeof err}`)
    return NextResponse.json({ error: 'Não foi possível simular agora. Tente de novo.' }, { status: 500 })
  }
}
