import { google, calendar_v3 } from 'googleapis'
import { getAuthenticatedClient } from './auth'

export async function getCalendarClient(workspaceId: string) {
  const auth = await getAuthenticatedClient(workspaceId)
  return google.calendar({ version: 'v3', auth })
}

// ── Listar eventos num intervalo ────────────────────────────────────────────
export async function listEvents(workspaceId: string, timeMin: Date, timeMax: Date) {
  const cal = await getCalendarClient(workspaceId)
  const { data } = await cal.events.list({
    calendarId: 'primary',
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
  doctorEmail: string // e-mail Google de quem conectou o calendário desta workspace
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
  const cal = await getCalendarClient(workspaceId)

  const attendees: calendar_v3.Schema$EventAttendee[] = [
    { email: doctorEmail, displayName: workspaceName, responseStatus: 'accepted' },
  ]
  if (patientEmail) {
    attendees.push({ email: patientEmail, displayName: patientName, responseStatus: 'needsAction' })
  }

  const { data } = await cal.events.insert({
    calendarId: 'primary',
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
  const cal = await getCalendarClient(workspaceId)

  const patch: calendar_v3.Schema$Event = {}

  if (updates.startTime && updates.durationMin) {
    const endTime = new Date(updates.startTime.getTime() + updates.durationMin * 60_000)
    patch.start = { dateTime: updates.startTime.toISOString(), timeZone: 'America/Sao_Paulo' }
    patch.end = { dateTime: endTime.toISOString(), timeZone: 'America/Sao_Paulo' }
  }

  if (updates.notes) patch.description = updates.notes

  const { data } = await cal.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: patch,
  })

  return data
}

// ── Cancelar evento (marca como cancelled e notifica participantes) ────────
export async function cancelEvent(workspaceId: string, eventId: string) {
  const cal = await getCalendarClient(workspaceId)

  await cal.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: { status: 'cancelled' },
  })
}

// ── Deletar evento permanentemente ──────────────────────────────────────────
export async function deleteEvent(workspaceId: string, eventId: string) {
  const cal = await getCalendarClient(workspaceId)
  await cal.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
  })
}

// ── Listar calendários disponíveis na conta ─────────────────────────────────
export async function listCalendars(workspaceId: string) {
  const cal = await getCalendarClient(workspaceId)
  const { data } = await cal.calendarList.list()
  return (data.items ?? []).map((c) => ({
    id: c.id,
    name: c.summary,
    primary: c.primary ?? false,
    color: c.backgroundColor,
  }))
}
