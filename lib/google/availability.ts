import { addMinutes, format, parseISO } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import { listEvents } from './calendar'

// Todos os horários são calculados na wall-clock de São Paulo via TZDate,
// independente do fuso horário em que o servidor (Vercel roda em UTC) executa —
// setHours/addMinutes num Date comum interpretariam os números no fuso do
// processo, o que agendaria a consulta ~3h fora do horário configurado.
const TZ = 'America/Sao_Paulo'

export interface TimeSlot {
  start: Date
  end: Date
  available: boolean
}

// Retorna todos os slots (livres e ocupados) para uma workspace numa data específica
export async function getAvailableSlots(workspaceId: string, date: Date): Promise<TimeSlot[]> {
  const supabase = createAdminClient()
  const zoned = new TZDate(date, TZ)
  const dayOfWeek = zoned.getDay() // 0=Dom ... 6=Sáb
  const dateStr = format(zoned, 'yyyy-MM-dd')

  // 1. Regras de disponibilidade para esse dia da semana
  const { data: rules } = await supabase
    .from('availability_rules')
    .select('start_time, end_time, slot_duration')
    .eq('workspace_id', workspaceId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  if (!rules || rules.length === 0) return []

  // 2. Exceção cadastrada para esta data
  const { data: exception } = await supabase
    .from('availability_exceptions')
    .select('type, start_time, end_time')
    .eq('workspace_id', workspaceId)
    .eq('date', dateStr)
    .maybeSingle()

  // Dia inteiro bloqueado
  if (exception?.type === 'blocked' && !exception.start_time) return []

  // 3. Gerar slots do dia com base nas regras (na wall-clock de São Paulo)
  const allSlots: TimeSlot[] = []
  const y = zoned.getFullYear()
  const m = zoned.getMonth()
  const d = zoned.getDate()

  for (const rule of rules) {
    const [startH, startM] = rule.start_time.split(':').map(Number)
    const [endH, endM] = rule.end_time.split(':').map(Number)

    let current = new TZDate(y, m, d, startH, startM, 0, TZ)
    const end = new TZDate(y, m, d, endH, endM, 0, TZ)

    while (addMinutes(current, rule.slot_duration) <= end) {
      const slotEnd = addMinutes(current, rule.slot_duration)
      allSlots.push({ start: current, end: slotEnd, available: true })
      current = slotEnd
    }
  }

  // 4. Eventos do Google Calendar no dia (indisponibilidade real)
  const dayStart = new TZDate(y, m, d, 0, 0, 0, TZ)
  const dayEnd = new TZDate(y, m, d, 23, 59, 59, TZ)
  let gcalEvents: Array<{ start: Date; end: Date }> = []

  try {
    const events = await listEvents(workspaceId, dayStart, dayEnd)
    gcalEvents = events
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        start: parseISO(e.start?.dateTime ?? e.start?.date ?? ''),
        end: parseISO(e.end?.dateTime ?? e.end?.date ?? ''),
      }))
  } catch {
    // Google Calendar não conectado ou indisponível — retorna slots sem
    // checar conflitos externos (ainda respeita availability_rules).
    return allSlots
  }

  // 5. Marcar slots ocupados
  return allSlots.map((slot) => {
    const blocked = gcalEvents.some((event) => slot.start < event.end && slot.end > event.start)
    return { ...slot, available: !blocked }
  })
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
