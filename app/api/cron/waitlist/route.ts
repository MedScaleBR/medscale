import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendWaitlistTemplate } from '@/lib/whatsapp/send'
import { decryptToken } from '@/lib/crypto'
import { getAvailableSlots } from '@/lib/google/availability'
import { addDays, format } from 'date-fns'
import { TZDate } from '@date-fns/tz'

const TZ = 'America/Sao_Paulo'
const DAYS_AHEAD = 3
const NOTIFY_COOLDOWN_HOURS = 24 // não reavisa a mesma entrada antes disso

// Disparado pelo Supabase pg_cron (ver supabase/cron.sql) uma vez por hora, 15min
// após o ponto. Verifica vagas nos próximos DAYS_AHEAD dias para quem está na
// lista de espera (FIFO) e notifica via WhatsApp — `notified_at` evita reenviar
// o aviso a cada execução enquanto a vaga continuar aberta.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()

  const { data: entries, error } = await supabase
    .from('waitlist')
    .select('id, workspace_id, patient_name, patient_phone, notified_at')
    .eq('status', 'waiting')
    .or(`notified_at.is.null,notified_at.lt.${cooldownCutoff}`)
    .order('created_at') // FIFO: quem entrou primeiro, é avisado primeiro

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!entries || entries.length === 0) {
    return NextResponse.json({ notified: 0 })
  }

  const workspaceIds = [...new Set(entries.map((e) => e.workspace_id))]
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, phone_number_id, meta_token')
    .in('id', workspaceIds)

  const workspaceById = new Map((workspaces ?? []).map((w) => [w.id, w]))

  let notified = 0
  const errors: string[] = []

  for (const entry of entries) {
    const workspace = workspaceById.get(entry.workspace_id)
    if (!workspace?.phone_number_id || !workspace?.meta_token) continue

    try {
      const slotsFound: string[] = []
      const today = new TZDate(new Date(), TZ)

      for (let i = 1; i <= DAYS_AHEAD; i++) {
        const day = addDays(today, i)
        const slots = await getAvailableSlots(entry.workspace_id, day)
        const free = slots.filter((s) => s.available)
        if (free.length === 0) continue

        const times = free.slice(0, 3).map((s) => format(s.start, 'HH:mm')).join(', ')
        slotsFound.push(`${format(day, 'dd/MM')}: ${times}`)
      }

      if (slotsFound.length === 0) continue // sem vagas, pular

      await sendWaitlistTemplate({
        to: entry.patient_phone,
        phoneNumberId: workspace.phone_number_id,
        token: decryptToken(workspace.meta_token),
        patientName: entry.patient_name,
        workspaceName: workspace.name,
        slots: slotsFound.join(' | '),
      })

      await supabase.from('waitlist').update({ notified_at: new Date().toISOString() }).eq('id', entry.id)
      notified += 1
    } catch (err) {
      errors.push(`${entry.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ notified, total: entries.length, errors })
}
