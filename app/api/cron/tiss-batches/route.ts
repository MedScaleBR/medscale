import { NextRequest, NextResponse } from 'next/server'
import { TZDate } from '@date-fns/tz'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { BILLING_TZ } from '@/lib/billing/constants'
import { ensureGuideSafely } from '@/lib/billing/guides'
import { isBatchDue } from '@/lib/billing/schedule'
import { createBatchesForInsurer, reportBatchFailure } from '@/lib/billing/batches'
import { hasTissIdentity } from '@/lib/billing/insurer'

export const maxDuration = 300

const SWEEP_DAYS = 60
// Uma execução por hora; um lote do cron nos últimos 55 minutos significa que
// esta hora já foi processada (pg_cron disparou duas vezes, ou alguém chamou
// a rota na mão). Guias nunca duplicam de qualquer forma — finalize_tiss_batch
// trava e confere o status —, isto evita lotes de erro repetidos.
const RERUN_GUARD_MINUTES = 55

// Disparado pelo Supabase pg_cron de hora em hora (ver supabase/cron.sql).
// 1. Varredura: consulta de convênio 'realizado' dos últimos 60 dias sem guia
//    ganha a guia (rede de segurança para falhas na assinatura/agenda).
// 2. Lotes: operadoras ativas cujo dia/hora programados (fuso de SP) são
//    agora têm as guias 'ready' fechadas em lotes.
// Só accounts com o módulo "billing" ativo. Resposta sem dado de paciente.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const now = new TZDate(new Date(), BILLING_TZ)

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id')
    .eq('is_active', true)
    .contains('modules', ['billing'])
  const accountIds = (accounts ?? []).map((a) => a.id)
  if (accountIds.length === 0) return NextResponse.json({ accounts: 0, guidesSwept: 0, batches: [] })

  // 1. Varredura de guias faltando.
  const since = new Date(now.getTime() - SWEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: done } = await supabase
    .from('appointments')
    .select('id')
    .in('account_id', accountIds)
    .eq('billing_type', 'convenio')
    .eq('status', 'realizado')
    .gte('scheduled_at', since)
  const doneIds = (done ?? []).map((a) => a.id)

  const withGuide = new Set<string>()
  for (let i = 0; i < doneIds.length; i += 200) {
    const { data: guides } = await supabase
      .from('tiss_guides')
      .select('appointment_id')
      .in('appointment_id', doneIds.slice(i, i + 200))
    for (const g of guides ?? []) withGuide.add(g.appointment_id)
  }
  const missing = doneIds.filter((id) => !withGuide.has(id))
  for (const appointmentId of missing) await ensureGuideSafely(appointmentId, supabase)

  // 2. Lotes programados.
  const { data: insurers } = await supabase
    .from('health_insurers')
    .select('id, account_id, ans_registry, provider_code, tiss_version, max_guides_per_batch, batch_weekdays, batch_hour, is_active')
    .in('account_id', accountIds)
    .eq('is_active', true)

  const due = (insurers ?? []).filter(hasTissIdentity).filter((i) => isBatchDue(i, now))
  const guardSince = new Date(now.getTime() - RERUN_GUARD_MINUTES * 60 * 1000).toISOString()
  const summary: Array<{ insurerId: string; result: string; guides?: number }> = []

  for (const insurer of due) {
    const { data: recent } = await supabase
      .from('tiss_batches')
      .select('id')
      .eq('insurer_id', insurer.id)
      .is('created_by', null)
      .gte('created_at', guardSince)
      .limit(1)
    if (recent && recent.length > 0) {
      summary.push({ insurerId: insurer.id, result: 'already_ran' })
      continue
    }

    try {
      const results = await createBatchesForInsurer(supabase, insurer, { createdBy: null, now })
      for (const r of results) summary.push({ insurerId: insurer.id, result: r.status, guides: r.guideCount })
      if (results.length === 0) summary.push({ insurerId: insurer.id, result: 'no_ready_guides' })
    } catch (err) {
      reportBatchFailure(err, { accountId: insurer.account_id, insurerId: insurer.id })
      summary.push({ insurerId: insurer.id, result: 'failed' })
    }
  }

  return NextResponse.json({ accounts: accountIds.length, guidesSwept: missing.length, batches: summary })
}
