import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyTranscriptionFailed } from '@/lib/transcriptions/notify-error'
import { trackTranscriptionError } from '@/lib/analytics/posthog-server'

// As rotas /api/transcriptions/process e /generate-record têm maxDuration de
// 300s. Linha parada em 'transcribing'/'generating' há mais que isso é função
// que a Vercel cortou no meio: o catch não rodou, então ninguém re-disparou.
const STUCK_AFTER_MINUTES = 6
// Só destrava o que travou há pouco. Linha mais antiga fica como está: o médico
// já desistiu dela, e reprocessar dias depois surpreende mais do que ajuda.
const LOOKBACK_MINUTES = 120
const MAX_ATTEMPTS = 3

const TIMEOUT_MESSAGE = 'Tempo esgotado no processamento'

// Para onde a linha volta antes de re-disparar a etapa que travou.
const RETRY_PLAN = {
  transcribing: { resetTo: 'pending', rpc: 'trigger_transcription_process' },
  generating: { resetTo: 'transcribed', rpc: 'trigger_transcription_generate' },
} as const

type StuckStatus = keyof typeof RETRY_PLAN
const STUCK_STATUSES: StuckStatus[] = ['transcribing', 'generating']

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) a cada 5 min.
// Conta como tentativa: na terceira, marca 'error' e avisa o médico, igual às
// rotas de processamento. LGPD: logs e erros levam só ids.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const now = Date.now()
  const stuckBefore = new Date(now - STUCK_AFTER_MINUTES * 60_000).toISOString()
  const notOlderThan = new Date(now - LOOKBACK_MINUTES * 60_000).toISOString()

  const { data: stuck, error } = await supabase
    .from('transcriptions')
    .select('id, status, retry_count, workspace_id, account_id, patient_id, patient_name, recorded_by')
    .in('status', STUCK_STATUSES)
    .lt('updated_at', stuckBefore)
    .gt('updated_at', notOlderThan)
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let retried = 0
  let failed = 0
  const errors: string[] = []

  for (const row of stuck ?? []) {
    const status = row.status as StuckStatus
    const plan = RETRY_PLAN[status]
    const attempt = (row.retry_count ?? 0) + 1

    try {
      if (attempt < MAX_ATTEMPTS) {
        // .eq('status') evita disputa com uma rota que terminou agora há pouco.
        const { data: updated, error: updateError } = await supabase
          .from('transcriptions')
          .update({ status: plan.resetTo, retry_count: attempt, error_message: TIMEOUT_MESSAGE })
          .eq('id', row.id)
          .eq('status', status)
          .select('id')
        if (updateError) throw new Error(updateError.message)
        if (!updated?.length) continue

        const { error: rpcError } = await supabase.rpc(plan.rpc, {
          p_transcription_id: row.id,
          p_app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
        })
        if (rpcError) throw new Error(rpcError.message)
        retried++
      } else {
        const { data: updated, error: updateError } = await supabase
          .from('transcriptions')
          .update({ status: 'error', error_message: TIMEOUT_MESSAGE })
          .eq('id', row.id)
          .eq('status', status)
          .select('id')
        if (updateError) throw new Error(updateError.message)
        if (!updated?.length) continue

        await trackTranscriptionError(row.recorded_by, {
          workspace_id: row.workspace_id,
          account_id: row.account_id,
          error_message: TIMEOUT_MESSAGE,
          retry_count: attempt,
        })
        await notifyTranscriptionFailed(row)
        failed++
      }
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (errors.length) console.error('[cron/stuck-transcriptions]', errors)
  return NextResponse.json({ retried, failed, errors })
}
