import { google, calendar_v3 } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthenticatedClient } from './auth'

// A conexão Google é única por account (google_tokens.account_id). Cada
// unidade aponta para um calendário dentro dessa conta via
// workspaces.gcal_calendar_id — NULL cai no calendário "primary".
export async function resolveWorkspaceCalendar(
  workspaceId: string
): Promise<{ accountId: string; calendarId: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('workspaces')
    .select('account_id, gcal_calendar_id')
    .eq('id', workspaceId)
    .single()

  if (error || !data) {
    throw new Error(`Workspace ${workspaceId} não encontrada ao resolver o calendário Google.`)
  }
  return { accountId: data.account_id, calendarId: data.gcal_calendar_id ?? 'primary' }
}

async function getWorkspaceCalendar(workspaceId: string) {
  const { accountId, calendarId } = await resolveWorkspaceCalendar(workspaceId)
  const auth = await getAuthenticatedClient(accountId)
  return { cal: google.calendar({ version: 'v3', auth }), calendarId }
}

// ── Listar eventos num intervalo (calendário da unidade) ────────────────────
export async function listEvents(workspaceId: string, timeMin: Date, timeMax: Date) {
  const { cal, calendarId } = await getWorkspaceCalendar(workspaceId)
  const { data } = await cal.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
    fields: 'items(id,summary,description,start,end,status,attendees,htmlLink,extendedProperties)',
  })
  return data.items ?? []
}

// ── Criar evento com convite para o paciente ────────────────────────────────
export interface CreateEventParams {
  workspaceId: string
  patientName: string
  patientEmail?: string // se não tiver, não envia convite
  patientPhone: string
  appointmentType: string
  startTime: Date
  durationMin: number
  notes?: string
  workspaceName: string
  doctorEmail: string // e-mail Google de quem conectou o calendário da account
}

export async function createEvent(params: CreateEventParams): Promise<calendar_v3.Schema$Event> {
  const {
    workspaceId,
    patientName,
    patientEmail,
    patientPhone,
    appointmentType,
    startTime,
    durationMin,
    notes,
    workspaceName,
    doctorEmail,
  } = params

  const endTime = new Date(startTime.getTime() + durationMin * 60_000)
  const { cal, calendarId } = await getWorkspaceCalendar(workspaceId)

  const attendees: calendar_v3.Schema$EventAttendee[] = [
    { email: doctorEmail, displayName: workspaceName, responseStatus: 'accepted' },
  ]
  if (patientEmail) {
    attendees.push({ email: patientEmail, displayName: patientName, responseStatus: 'needsAction' })
  }

  const { data } = await cal.events.insert({
    calendarId,
    sendUpdates: patientEmail ? 'all' : 'none',
    requestBody: {
      summary: `${appointmentType} — ${patientName}`,
      description: [
        `Paciente: ${patientName}`,
        `Telefone: ${patientPhone}`,
        notes ? `Observações: ${notes}` : '',
        '',
        'Agendado via MedScale',
      ]
        .filter(Boolean)
        .join('\n'),
      start: { dateTime: startTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      attendees,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // e-mail 24h antes
          { method: 'popup', minutes: 30 }, // popup 30min antes
        ],
      },
      extendedProperties: {
        private: {
          medscale: 'true',
          // Unidade dona do evento — o reconcile usa isso para atribuir o
          // evento à workspace certa quando duas unidades compartilham calendário.
          workspace_id: workspaceId,
          patientPhone: patientPhone,
        },
      },
    },
  })

  return data
}

// ── Atualizar evento ────────────────────────────────────────────────────────
export interface UpdateEventParams {
  startTime?: Date
  durationMin?: number
  notes?: string
}

export async function updateEvent(
  workspaceId: string,
  eventId: string,
  updates: UpdateEventParams
): Promise<calendar_v3.Schema$Event> {
  const { cal, calendarId } = await getWorkspaceCalendar(workspaceId)

  const patch: calendar_v3.Schema$Event = {}

  if (updates.startTime && updates.durationMin) {
    const endTime = new Date(updates.startTime.getTime() + updates.durationMin * 60_000)
    patch.start = { dateTime: updates.startTime.toISOString(), timeZone: 'America/Sao_Paulo' }
    patch.end = { dateTime: endTime.toISOString(), timeZone: 'America/Sao_Paulo' }
  }

  if (updates.notes) patch.description = updates.notes

  const { data } = await cal.events.patch({
    calendarId,
    eventId,
    sendUpdates: 'all',
    requestBody: patch,
  })

  return data
}

// ── Cancelar evento (marca como cancelled e notifica participantes) ────────
export async function cancelEvent(workspaceId: string, eventId: string) {
  const { cal, calendarId } = await getWorkspaceCalendar(workspaceId)

  await cal.events.patch({
    calendarId,
    eventId,
    sendUpdates: 'all',
    requestBody: { status: 'cancelled' },
  })
}

// ── Deletar evento permanentemente ──────────────────────────────────────────
export async function deleteEvent(workspaceId: string, eventId: string) {
  const { cal, calendarId } = await getWorkspaceCalendar(workspaceId)
  await cal.events.delete({
    calendarId,
    eventId,
    sendUpdates: 'all',
  })
}

// ── Listar calendários disponíveis na conexão da account ────────────────────
// Usado pela tela de mapeamento unidade → calendário.
export async function listCalendars(accountId: string) {
  const auth = await getAuthenticatedClient(accountId)
  const cal = google.calendar({ version: 'v3', auth })
  const { data } = await cal.calendarList.list()
  return (data.items ?? []).map((c) => ({
    id: c.id,
    name: c.summary,
    primary: c.primary ?? false,
    color: c.backgroundColor,
  }))
}

// ── Criar um calendário novo na conta Google (uma unidade sem calendário
//    próprio ainda). Retorna o id para gravar em workspaces.gcal_calendar_id.
export async function createCalendar(accountId: string, summary: string): Promise<string> {
  const auth = await getAuthenticatedClient(accountId)
  const cal = google.calendar({ version: 'v3', auth })
  const { data } = await cal.calendars.insert({
    requestBody: { summary, timeZone: 'America/Sao_Paulo' },
  })
  if (!data.id) throw new Error('Google não retornou o id do calendário criado.')
  return data.id
}
