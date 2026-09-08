import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/server'
import { sendWaitlistTemplate, sendWaitlistSpecificTemplate } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getAvailableSlots, isSlotAvailable } from '@/lib/google/availability'
import { trackWaitlistPatientNotified } from '@/lib/analytics/posthog-server'
import { partitionWaitlist, formatBotSlot, type WaitlistRow } from '@/lib/waitlist/match'
import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'

const TZ = 'America/Sao_Paulo'
const DAYS_AHEAD = 3
const NOTIFY_COOLDOWN_HOURS = 24 // não reavisa a mesma entrada antes disso
const SLOT_DURATION_MIN = 30

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, 15min
// após o ponto.
// - Entradas manuais (equipe): vagas em qualquer horário nos próximos DAYS_AHEAD dias.
// - Entradas da Maria (source 'bot'): só o dia (e horário) que o paciente pediu,
//   avisadas com o template que nomeia o slot.
// `notified_at` + cooldown de 24h evitam reenviar o aviso enquanto a vaga persistir.
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const supabase = createAdminClient()

  // 1. Expira entradas da Maria cujo dia desejado já passou (fuso São Paulo).
  const todaySP = format(new TZDate(new Date(), TZ), 'yyyy-MM-dd')
  await supabase
    .from('waitlist')
    .update({ status: 'expired' })
    .eq('status', 'waiting')
    .not('desired_date', 'is', null)
    .lt('desired_date', todaySP)

  // 2. Entradas ainda em espera, fora do cooldown.
  const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
  const { data: entries, error } = await supabase
    .from('waitlist')
    .select(
      'id, workspace_id, account_id, patient_name, patient_phone, notified_at, desired_date, desired_time, source'
    )
    .eq('status', 'waiting')
    .or(`notified_at.is.null,notified_at.lt.${cooldownCutoff}`)
    .order('created_at') // FIFO: quem entrou primeiro, é avisado primeiro

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!entries || entries.length === 0) {
    return NextResponse.json({ notified: 0 })
  }

  const { bot, manual } = partitionWaitlist(entries as WaitlistRow[])

  const workspaceIds = [...new Set(entries.map((e) => e.workspace_id))]
  const accountIds = [...new Set(entries.map((e) => e.account_id))]

  const [{ data: workspaces }, { data: botConfigs }] = await Promise.all([
    supabase.from('workspaces').select('id, name').in('id', workspaceIds),
    supabase.from('bot_config').select('account_id, phone_number_id, meta_token').in('account_id', accountIds),
  ])

  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]))
  const connByAccount = new Map((botConfigs ?? []).map((c) => [c.account_id, c]))

  let notified = 0
  const errors: string[] = []
  const markNotified = (id: string) =>
    supabase.from('waitlist').update({ notified_at: new Date().toISOString() }).eq('id', id)

  // 3. Entradas manuais — vagas em qualquer horário nos próximos DAYS_AHEAD dias.
  for (const entry of manual) {
    const workspace = workspaceById.get(entry.workspace_id)
    const conn = connByAccount.get(entry.account_id)
    if (!workspace || !conn?.phone_number_id || !conn?.meta_token) continue

    try {
      const slotsFound: string[] = []
      const today = new TZDate(new Date(), TZ)

      for (let i = 1; i <= DAYS_AHEAD; i++) {
        const day = addDays(today, i)
        const free = (await getAvailableSlots(entry.workspace_id, day)).filter((s) => s.available)
        if (free.length === 0) continue

        const times = free.slice(0, 3).map((s) => format(s.start, 'HH:mm')).join(', ')
        slotsFound.push(`${format(day, 'dd/MM')}: ${times}`)
      }

      if (slotsFound.length === 0) continue // sem vagas, pular

      await sendWaitlistTemplate({
        to: entry.patient_phone,
        phoneNumberId: conn.phone_number_id,
        token: decryptToken(conn.meta_token),
        patientName: entry.patient_name,
        workspaceName: workspace.name,
        slots: slotsFound.join(' | '),
      })

      await markNotified(entry.id)
      await trackWaitlistPatientNotified(entry.workspace_id, {
        workspace_id: entry.workspace_id,
        account_id: entry.account_id,
      })
      notified += 1
    } catch (err) {
      errors.push(`${entry.id}: ${String(err)}`)
    }
  }

  // 4. Entradas da Maria — casa só o dia (e horário) desejado.
  for (const entry of bot) {
    const workspace = workspaceById.get(entry.workspace_id)
    const conn = connByAccount.get(entry.account_id)
    if (!workspace || !conn?.phone_number_id || !conn?.meta_token || !entry.desired_date) continue

    try {
      let slot: string | null = null

      if (entry.desired_time) {
        const at = new TZDate(`${entry.desired_date}T${entry.desired_time.slice(0, 5)}-03:00`, TZ)
        const ok = await isSlotAvailable(entry.workspace_id, at, SLOT_DURATION_MIN)
        slot = ok ? formatBotSlot(entry.desired_date, entry.desired_time, []) : null
      } else {
        const day = new TZDate(`${entry.desired_date}T12:00:00`, TZ)
        const free = (await getAvailableSlots(entry.workspace_id, day)).filter((s) => s.available)
        slot = free.length
          ? formatBotSlot(entry.desired_date, null, free.slice(0, 3).map((s) => format(s.start, 'HH:mm')))
          : null
      }

      if (!slot) continue

      await sendWaitlistSpecificTemplate({
        to: entry.patient_phone,
        phoneNumberId: conn.phone_number_id,
        token: decryptToken(conn.meta_token),
        patientName: entry.patient_name,
        workspaceName: workspace.name,
        slot,
      })

      await markNotified(entry.id)
      await trackWaitlistPatientNotified(entry.workspace_id, {
        workspace_id: entry.workspace_id,
        account_id: entry.account_id,
      })
      notified += 1
    } catch (err) {
      errors.push(`${entry.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ notified, total: entries.length, errors })
}
