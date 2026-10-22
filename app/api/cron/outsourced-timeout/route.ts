import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { PENDING_EXTERNAL_STATUS } from '@/types/database'
import { deleteEvent } from '@/lib/google/calendar'
import { notifyOutsourcedIssue } from '@/lib/outsourced/notify'

const ESCALATION_HOURS = 4 // sem resposta da clínica parceira há mais disso → avisa a equipe

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, aos
// 20min. Duas passadas sobre as consultas pendente_confirmacao_externa:
//   1. expira as que o horário já passou (a clínica nunca confirmou) →
//      cancelado, evento do Google apagado, equipe avisada;
//   2. escala as solicitadas há mais de ESCALATION_HOURS e ainda sem aviso →
//      equipe avisada uma única vez (external_escalated_at). O status não muda:
//      se a clínica confirmar depois, confirma normalmente.
// Expira antes de escalar, então um vencido não recebe os dois avisos.
// LGPD: erros e logs levam só ids.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()
  const errors: string[] = []
  let expired = 0
  let escalated = 0

  // ── 1. Expirar ───────────────────────────────────────────────────────────
  const { data: overdue, error: overdueError } = await supabase
    .from('appointments')
    .select('id, account_id, workspace_id, gcal_event_id')
    .eq('status', PENDING_EXTERNAL_STATUS)
    .lt('scheduled_at', nowIso)

  if (overdueError) return NextResponse.json({ error: overdueError.message }, { status: 500 })

  for (const appt of overdue ?? []) {
    try {
      // Condicional no status: se a clínica confirmou (ou o paciente cancelou)
      // no meio do caminho, a confirmação vence e nada aqui roda.
      const { data: updated, error } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('id', appt.id)
        .eq('status', PENDING_EXTERNAL_STATUS)
        .select('id')
      if (error) throw new Error(error.message)
      if (!updated || updated.length === 0) continue

      if (appt.gcal_event_id) await deleteEvent(appt.workspace_id, appt.gcal_event_id)
      await notifyOutsourcedIssue({
        accountId: appt.account_id,
        workspaceId: appt.workspace_id,
        appointmentId: appt.id,
        reason: 'clinica_externa_timeout',
      })
      expired++
    } catch (err) {
      errors.push(`expirar ${appt.id}: ${err instanceof Error ? err.message : 'erro'}`)
    }
  }

  // ── 2. Escalar ───────────────────────────────────────────────────────────
  const escalationCutoff = new Date(now.getTime() - ESCALATION_HOURS * 60 * 60 * 1000).toISOString()
  const { data: stale, error: staleError } = await supabase
    .from('appointments')
    .select('id, account_id, workspace_id')
    .eq('status', PENDING_EXTERNAL_STATUS)
    .lt('external_requested_at', escalationCutoff)
    .is('external_escalated_at', null)
    .gte('scheduled_at', nowIso)

  if (staleError) {
    errors.push(`escalar: ${staleError.message}`)
    return NextResponse.json({ escalated, expired, errors })
  }

  for (const appt of stale ?? []) {
    try {
      // Marca antes de avisar: no pior caso (falha no aviso) a equipe deixa de
      // ser avisada, nunca é avisada em dobro a cada hora.
      const { data: marked, error } = await supabase
        .from('appointments')
        .update({ external_escalated_at: nowIso })
        .eq('id', appt.id)
        .eq('status', PENDING_EXTERNAL_STATUS)
        .is('external_escalated_at', null)
        .select('id')
      if (error) throw new Error(error.message)
      if (!marked || marked.length === 0) continue

      await notifyOutsourcedIssue({
        accountId: appt.account_id,
        workspaceId: appt.workspace_id,
        appointmentId: appt.id,
        reason: 'clinica_externa_timeout',
      })
      escalated++
    } catch (err) {
      errors.push(`escalar ${appt.id}: ${err instanceof Error ? err.message : 'erro'}`)
    }
  }

  return NextResponse.json({ escalated, expired, errors })
}
