import { addMinutes, format, parseISO } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import { listEvents } from './calendar'

// Todos os horários são calculados na wall-clock de São Paulo via TZDate,
// independente do fuso horário em que o servidor (Vercel roda em UTC) executa —
// setHours/addMinutes num Date comum interpretariam os números no fuso do
// processo, o que agendaria a consulta ~3h fora do horário configurado.
const TZ = 'America/Sao_Paulo'

const DEFAULT_SLOT_DURATION = 30

export interface TimeSlot {
  start: Date
  end: Date
  available: boolean
}

interface Interval {
  start: Date
  end: Date
}

function overlaps(slot: TimeSlot, interval: Interval): boolean {
  return slot.start < interval.end && slot.end > interval.start
}

function parseHM(value: string): [number, number] {
  const [h, m] = value.split(':').map(Number)
  return [h, m]
}

// Retorna todos os slots (livres e ocupados) para uma workspace numa data específica
export async function getAvailableSlots(workspaceId: string, date: Date): Promise<TimeSlot[]> {
  const supabase = createAdminClient()
  const zoned = new TZDate(date, TZ)
  const dayOfWeek = zoned.getDay() // 0=Dom ... 6=Sáb
  const dateStr = format(zoned, 'yyyy-MM-dd')

  const y = zoned.getFullYear()
  const m = zoned.getMonth()
  const d = zoned.getDate()
  const at = (h: number, min: number) => new TZDate(y, m, d, h, min, 0, TZ)

  // 1. Regras de disponibilidade para esse dia da semana
  const { data: rules } = await supabase
    .from('availability_rules')
    .select('start_time, end_time, slot_duration')
    .eq('workspace_id', workspaceId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  // 2. Exceções cadastradas para esta data. Podem ser mais de uma (ex: bloquear
  // a manhã e abrir um horário extra à noite), então lê a lista inteira —
  // `.maybeSingle()` aqui lançava erro justamente nesse caso.
  const { data: exceptions } = await supabase
    .from('availability_exceptions')
    .select('type, start_time, end_time')
    .eq('workspace_id', workspaceId)
    .eq('date', dateStr)

  const exceptionList = exceptions ?? []

  // Dia inteiro bloqueado (type 'blocked' sem horário) — nada disponível,
  // nem os horários extras, se houver.
  if (exceptionList.some((e) => e.type === 'blocked' && !e.start_time)) return []

  // 3. Janelas de atendimento do dia: as regras recorrentes + as exceções do
  // tipo 'extra'. Um horário extra vale por si só — é o caso de um sábado
  // pontual, em que não existe availability_rules para o dia da semana.
  const defaultDuration = rules?.[0]?.slot_duration ?? DEFAULT_SLOT_DURATION
  const windows = [
    ...(rules ?? []).map((r) => ({ start: r.start_time, end: r.end_time, duration: r.slot_duration })),
    ...exceptionList
      .filter((e) => e.type === 'extra' && e.start_time && e.end_time)
      .map((e) => ({ start: e.start_time as string, end: e.end_time as string, duration: defaultDuration })),
  ]

  if (windows.length === 0) return []

  // 4. Gerar slots das janelas (na wall-clock de São Paulo)
  const slotsByStart = new Map<number, TimeSlot>()
  for (const window of windows) {
    const [startH, startM] = parseHM(window.start)
    const [endH, endM] = parseHM(window.end)
    const duration = window.duration || DEFAULT_SLOT_DURATION

    let current = at(startH, startM)
    const end = at(endH, endM)

    while (addMinutes(current, duration) <= end) {
      const slotEnd = addMinutes(current, duration)
      // Janelas sobrepostas (uma regra e um extra no mesmo horário) não podem
      // gerar o mesmo horário duas vezes na lista oferecida ao paciente.
      if (!slotsByStart.has(current.getTime())) {
        slotsByStart.set(current.getTime(), { start: current, end: slotEnd, available: true })
      }
      current = slotEnd
    }
  }

  const allSlots = [...slotsByStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime())

  // 5. Bloqueios parciais do dia (type 'blocked' com horário) — ex: almoço
  // estendido, compromisso pessoal cadastrado na própria MedScale.
  const busy: Interval[] = exceptionList
    .filter((e) => e.type === 'blocked' && e.start_time && e.end_time)
    .map((e) => {
      const [sh, sm] = parseHM(e.start_time as string)
      const [eh, em] = parseHM(e.end_time as string)
      return { start: at(sh, sm), end: at(eh, em) }
    })

  const dayStart = at(0, 0)
  const dayEnd = new TZDate(y, m, d, 23, 59, 59, TZ)

  // 6. Consultas já marcadas no próprio Supabase. Sem isto, uma workspace sem
  // Google Calendar conectado oferecia ao paciente um horário em que já havia
  // outra consulta marcada — o bot agendava duas pessoas no mesmo slot.
  const { data: appointments } = await supabase
    .from('appointments')
    .select('scheduled_at, duration_min')
    .eq('workspace_id', workspaceId)
    .in('status', ['agendado', 'confirmado'])
    .gte('scheduled_at', dayStart.toISOString())
    .lte('scheduled_at', dayEnd.toISOString())

  for (const appointment of appointments ?? []) {
    const start = new Date(appointment.scheduled_at)
    if (Number.isNaN(start.getTime())) continue
    busy.push({ start, end: addMinutes(start, appointment.duration_min ?? DEFAULT_SLOT_DURATION) })
  }

  // 7. Eventos do Google Calendar no dia (indisponibilidade real)
  try {
    const events = await listEvents(workspaceId, dayStart, dayEnd)
    for (const event of events) {
      if (event.status === 'cancelled') continue
      const start = parseISO(event.start?.dateTime ?? event.start?.date ?? '')
      const end = parseISO(event.end?.dateTime ?? event.end?.date ?? '')
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
      busy.push({ start, end })
    }
  } catch (err) {
    // Google Calendar não conectado ou indisponível (token expirado, API fora
    // do ar) — degrada para os bloqueios que já conhecemos, em vez de travar
    // a agenda inteira. Fica registrado para não virar falha silenciosa.
    console.error(`getAvailableSlots: listEvents falhou para workspace ${workspaceId}`, err)
  }

  // 8. Marcar slots ocupados
  return allSlots.map((slot) => ({
    ...slot,
    available: !busy.some((interval) => overlaps(slot, interval)),
  }))
}

// Versão resumida para o bot: apenas horários livres, formatados HH:mm
export async function getFreeSlotsForBot(workspaceId: string, date: Date): Promise<string[]> {
  const slots = await getAvailableSlots(workspaceId, date)
  return slots.filter((s) => s.available).map((s) => format(s.start, 'HH:mm'))
}

// Verifica se um horário específico (instante exato) está disponível
export async function isSlotAvailable(workspaceId: string, start: Date, durationMin: number): Promise<boolean> {
  const slots = await getAvailableSlots(workspaceId, start)
  const end = addMinutes(start, durationMin)
  return slots.some((s) => s.available && s.start.getTime() === start.getTime() && s.end.getTime() <= end.getTime())
}
