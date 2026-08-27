import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { saoPauloDateOnly } from '@/lib/revenue/cycle'
import { summarizeRevenueEntries, buildDailySummaryMessage } from '@/lib/revenue/summary'
import { sendFinanceReply } from '@/lib/finance/agent'

// Disparado pelo Supabase pg_cron uma vez por hora (ver supabase/cron.sql).
// Envia o fechamento de receita do dia no WhatsApp do owner, para cada
// workspace cujo revenue_settings.daily_summary_hour bate com a hora atual
// em São Paulo. Módulo "revenue_cycle" precisa estar ativo na account.
//
// Observação: a mensagem vai pelo número financeiro dedicado da MedScale
// (mesmo canal do agente PF/PJ), em texto livre — se o owner não interagiu
// com esse número nas últimas 24h, a Meta exige um template aprovado. Em
// produção, trocar por um template quando o volume justificar.

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const nowHour =
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(now)
    ) % 24
  const today = saoPauloDateOnly(now.toISOString())
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(now)

  // Workspaces com resumo agendado para esta hora.
  const { data: settingsRows } = await supabase
    .from('revenue_settings')
    .select('workspace_id, account_id, daily_summary_only_with_activity')
    .eq('daily_summary_enabled', true)
    .eq('daily_summary_hour', nowHour)

  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ hour: nowHour, sent: 0 })
  }

  // Só accounts com o módulo ativo.
  const accountIds = [...new Set(settingsRows.map((s) => s.account_id))]
  const { data: accounts } = await supabase.from('accounts').select('id, modules').in('id', accountIds)
  const enabledAccounts = new Set(
    (accounts ?? []).filter((a) => a.modules?.includes('revenue_cycle')).map((a) => a.id)
  )
  const targets = settingsRows.filter((s) => enabledAccounts.has(s.account_id))

  // Owner (telefone) por account.
  const targetAccountIds = [...new Set(targets.map((t) => t.account_id))]
  const { data: ownerMemberships } = targetAccountIds.length
    ? await supabase
        .from('memberships')
        .select('account_id, user_id')
        .in('account_id', targetAccountIds)
        .eq('role', 'owner')
        .eq('status', 'active')
    : { data: [] }
  const ownerByAccount = new Map((ownerMemberships ?? []).map((m) => [m.account_id, m.user_id]))
  const ownerUserIds = [...new Set([...ownerByAccount.values()])]
  const { data: profiles } = ownerUserIds.length
    ? await supabase.from('profiles').select('id, phone').in('id', ownerUserIds)
    : { data: [] }
  const phoneByUser = new Map((profiles ?? []).map((p) => [p.id, p.phone]))

  let sent = 0
  const skipped: string[] = []

  for (const t of targets) {
    const ownerId = ownerByAccount.get(t.account_id)
    const phone = ownerId ? phoneByUser.get(ownerId) : null
    if (!phone) {
      skipped.push(`${t.workspace_id}:sem-telefone`)
      continue
    }

    const { data: entries } = await supabase
      .from('revenue_entries')
      .select('amount, payment_status, appointments(patient_name), patients(full_name)')
      .eq('workspace_id', t.workspace_id)
      .eq('due_date', today)

    const rows = (entries ?? []) as unknown as Array<{
      amount: number | string
      payment_status: 'pending' | 'realized' | 'paid' | 'cancelled' | 'refunded'
      appointments: { patient_name: string } | null
      patients: { full_name: string } | null
    }>

    const totals = summarizeRevenueEntries(rows)
    const hadActivity = totals.counts.realized + totals.counts.paid > 0
    if (t.daily_summary_only_with_activity && !hadActivity) {
      skipped.push(`${t.workspace_id}:sem-atividade`)
      continue
    }
    // Nada previsto e nada aconteceu — não manda um resumo vazio.
    if (rows.length === 0) {
      skipped.push(`${t.workspace_id}:sem-consultas`)
      continue
    }

    const pendingPatients = rows
      .filter((e) => e.payment_status === 'realized')
      .map((e) => ({
        name: e.patients?.full_name ?? e.appointments?.patient_name ?? 'Paciente',
        amount: Number(e.amount) || 0,
      }))

    const message = buildDailySummaryMessage({ dateLabel, totals, pendingPatients })

    try {
      await sendFinanceReply(phone, message)
      sent++
    } catch (err) {
      console.error('[daily-revenue-summary] falha ao enviar', {
        workspaceId: t.workspace_id,
        error: err instanceof Error ? err.message : String(err),
      })
      skipped.push(`${t.workspace_id}:erro-envio`)
    }
  }

  return NextResponse.json({ hour: nowHour, sent, skipped })
}
