import { createAdminClient } from '@/lib/supabase/server'
import { listEvents } from './calendar'
import { isGoogleConnected } from './auth'
import type { Database, AppointmentStatus } from '@/types/database'

export type AppointmentRow = Database['public']['Tables']['appointments']['Row']

export interface BusyBlock {
  start: string // ISO
  end: string // ISO
  summary: string
}

export interface ReconcileResult {
  appointments: AppointmentRow[]
  busyBlocks: BusyBlock[]
  googleConnected: boolean
}

type GoogleEvent = Awaited<ReturnType<typeof listEvents>>[number]

// Estados que só nós controlamos — o Google não tem esse conceito, então o
// reconcile nunca pode sobrescrevê-los de volta pra 'agendado'/'cancelado'.
const TERMINAL_STATUSES: AppointmentStatus[] = ['realizado', 'no_show', 'cancelado']

function isMedscaleEvent(event: GoogleEvent): boolean {
  return event.extendedProperties?.private?.medscale === 'true'
}

// Faz o parse reverso do formato que lib/google/calendar.ts#createEvent usa:
// summary "${appointmentType} — ${patientName}", descrição com linhas
// "Paciente: X" / "Telefone: Y". Cobre o caso raro de um evento flagado
// medscale sem linha correspondente no Supabase (ex: linha apagada à mão).
function parsePatientFromEvent(summary?: string | null, description?: string | null) {
  let patientName = ''
  let patientPhone = ''
  for (const line of (description ?? '').split('\n')) {
    const nameMatch = line.match(/^Paciente:\s*(.+)$/)
    const phoneMatch = line.match(/^Telefone:\s*(.+)$/)
    if (nameMatch) patientName = nameMatch[1].trim()
    if (phoneMatch) patientPhone = phoneMatch[1].trim()
  }
  if (!patientName) {
    const parts = (summary ?? '').split('—')
    patientName = (parts.length > 1 ? parts.slice(1).join('—') : (summary ?? '')).trim() || 'Evento do Google Calendar'
  }
  return { patientName, patientPhone }
}

// Fonte de verdade da /agenda: lê o Google Calendar ao vivo e reconcilia com
// o espelho no Supabase (appointments), que continua guardando o histórico
// pra CRM/receita/transcrições. Workspace sem Google conectado cai direto no
// comportamento antigo (Supabase puro). Falha ao ler o Google (fora do ar,
// token revogado) também degrada pro Supabase — nunca trava a leitura.
export async function reconcileCalendar(workspaceId: string, from: Date, to: Date): Promise<ReconcileResult> {
  const supabase = createAdminClient()
  const { connected } = await isGoogleConnected(workspaceId)

  const fetchSupabaseRows = async () => {
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('scheduled_at', from.toISOString())
      .lte('scheduled_at', to.toISOString())
      .order('scheduled_at')
    return data ?? []
  }

  if (!connected) {
    return { appointments: await fetchSupabaseRows(), busyBlocks: [], googleConnected: false }
  }

  let events: GoogleEvent[]
  try {
    events = await listEvents(workspaceId, from, to)
  } catch (err) {
    console.error(`reconcileCalendar: listEvents falhou para workspace ${workspaceId}`, err)
    return { appointments: await fetchSupabaseRows(), busyBlocks: [], googleConnected: true }
  }

  const rows = await fetchSupabaseRows()
  const rowsByGcalId = new Map(rows.filter((r) => r.gcal_event_id).map((r) => [r.gcal_event_id as string, r]))
  const resultById = new Map(rows.map((r) => [r.id, r]))

  const medscaleEvents = events.filter(isMedscaleEvent)
  const busyEvents = events.filter((e) => !isMedscaleEvent(e) && e.status !== 'cancelled')
  const seenGcalIds = new Set<string>()

  for (const event of medscaleEvents) {
    if (!event.id) continue
    seenGcalIds.add(event.id)

    const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : null
    const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null
    const cancelledOnGoogle = event.status === 'cancelled'
    const match = rowsByGcalId.get(event.id)

    if (match) {
      const patch: Partial<AppointmentRow> = {}
      if (cancelledOnGoogle) {
        if (!TERMINAL_STATUSES.includes(match.status)) patch.status = 'cancelado'
      } else if (eventStart && eventEnd) {
        const durationMin = Math.max(1, Math.round((eventEnd.getTime() - eventStart.getTime()) / 60_000))
        if (new Date(match.scheduled_at).getTime() !== eventStart.getTime() || match.duration_min !== durationMin) {
          patch.scheduled_at = eventStart.toISOString()
          patch.duration_min = durationMin
        }
      }
      if (Object.keys(patch).length > 0) {
        const { data: updated } = await supabase.from('appointments').update(patch).eq('id', match.id).select().single()
        if (updated) resultById.set(updated.id, updated)
      }
    } else if (!cancelledOnGoogle && eventStart && eventEnd) {
      const { data: workspace } = await supabase.from('workspaces').select('account_id').eq('id', workspaceId).single()
      if (!workspace) continue

      const { patientName, patientPhone } = parsePatientFromEvent(event.summary, event.description)
      const durationMin = Math.max(1, Math.round((eventEnd.getTime() - eventStart.getTime()) / 60_000))

      const { data: inserted } = await supabase
        .from('appointments')
        .upsert(
          {
            workspace_id: workspaceId,
            account_id: workspace.account_id,
            patient_name: patientName,
            patient_phone: patientPhone,
            scheduled_at: eventStart.toISOString(),
            duration_min: durationMin,
            type: 'outro',
            source: 'importado',
            status: 'agendado',
            gcal_event_id: event.id,
          },
          { onConflict: 'gcal_event_id' }
        )
        .select()
        .single()
      if (inserted) resultById.set(inserted.id, inserted)
    }
  }

  // Linha tinha gcal_event_id mas ele sumiu da busca fresca (cancelado no
  // Google ou apagado de vez) — cancela, a não ser que já esteja num estado
  // terminal nosso.
  for (const row of rows) {
    if (!row.gcal_event_id) continue
    if (seenGcalIds.has(row.gcal_event_id)) continue
    if (TERMINAL_STATUSES.includes(row.status)) continue
    const { data: updated } = await supabase
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', row.id)
      .select()
      .single()
    if (updated) resultById.set(updated.id, updated)
  }

  const busyBlocks: BusyBlock[] = busyEvents
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({ start: e.start!.dateTime!, end: e.end!.dateTime!, summary: e.summary ?? '(sem título)' }))

  return { appointments: [...resultById.values()], busyBlocks, googleConnected: true }
}
