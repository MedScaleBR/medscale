import { addMinutes, format, parseISO } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createAdminClient } from '@/lib/supabase/server'
import { PENDING_EXTERNAL_STATUS, type AppointmentStatus } from '@/types/database'
import { listEvents } from './calendar'
import { addDaysToDate, ruleAppliesOn, type RecurrenceRule } from '@/lib/scheduling/recurrence'

// Todos os horários são calculados na wall-clock de São Paulo via TZDate,
// independente do fuso horário em que o servidor (Vercel roda em UTC) executa —
// setHours/addMinutes num Date comum interpretariam os números no fuso do
// processo, o que agendaria a consulta ~3h fora do horário configurado.
const TZ = 'America/Sao_Paulo'

const DEFAULT_SLOT_DURATION = 30

// Consulta pendente de clínica parceira ocupa o slot enquanto espera a resposta.
export const SLOT_BLOCKING_STATUSES: AppointmentStatus[] = ['agendado', 'confirmado', PENDING_EXTERNAL_STATUS]

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

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface RuleRow {
  day_of_week?: number
  start_time: string
  end_time: string
  slot_duration: number
  interval_weeks?: number | null
  anchor_date?: string | null
}

interface ExceptionRow {
  date?: string
  type: string
  start_time: string | null
  end_time: string | null
}

const RULE_COLUMNS = 'start_time, end_time, slot_duration'
const RECURRENCE_COLUMNS = 'interval_weeks, anchor_date'

/**
 * Regras ativas da unidade (todas ou só de um dia da semana). Sem as colunas
 * de repetição (migration pendente), cai nas antigas: toda semana.
 */
async function loadRules(supabase: SupabaseAdmin, workspaceId: string, dayOfWeek?: number): Promise<RuleRow[]> {
  const query = (columns: string) => {
    let q = supabase.from('availability_rules').select(columns).eq('workspace_id', workspaceId)
    if (dayOfWeek !== undefined) q = q.eq('day_of_week', dayOfWeek)
    return q.eq('is_active', true)
  }
  const base = dayOfWeek === undefined ? `day_of_week, ${RULE_COLUMNS}` : RULE_COLUMNS
  const withRecurrence = await query(`${base}, ${RECURRENCE_COLUMNS}`)
  if (!withRecurrence.error) return (withRecurrence.data ?? []) as unknown as RuleRow[]
  const legacy = await query(base)
  return (legacy.data ?? []) as unknown as RuleRow[]
}

/** Eventos do Google Calendar no período, como intervalos ocupados. */
async function googleBusy(workspaceId: string, from: Date, to: Date): Promise<Interval[]> {
  try {
    const events = await listEvents(workspaceId, from, to)
    const busy: Interval[] = []
    for (const event of events) {
      if (event.status === 'cancelled') continue
      const start = parseISO(event.start?.dateTime ?? event.start?.date ?? '')
      const end = parseISO(event.end?.dateTime ?? event.end?.date ?? '')
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
      busy.push({ start, end })
    }
    return busy
  } catch (err) {
    // Google Calendar não conectado ou indisponível (token expirado, API fora
    // do ar) — degrada para os bloqueios que já conhecemos, em vez de travar
    // a agenda inteira. Fica registrado para não virar falha silenciosa.
    console.error(`getAvailableSlots: listEvents falhou para workspace ${workspaceId}`, err)
    return []
  }
}

function appointmentsBusy(rows: { scheduled_at: string; duration_min: number | null }[] | null): Interval[] {
  const busy: Interval[] = []
  for (const appointment of rows ?? []) {
    const start = new Date(appointment.scheduled_at)
    if (Number.isNaN(start.getTime())) continue
    busy.push({ start, end: addMinutes(start, appointment.duration_min ?? DEFAULT_SLOT_DURATION) })
  }
  return busy
}

function hasFullDayBlock(exceptions: ExceptionRow[]): boolean {
  return exceptions.some((e) => e.type === 'blocked' && !e.start_time)
}

function hasExtraWindow(exceptions: ExceptionRow[]): boolean {
  return exceptions.some((e) => e.type === 'extra' && e.start_time && e.end_time)
}

/**
 * Slots de um dia (AAAA-MM-DD em São Paulo) a partir das regras que valem
 * nele, das exceções do dia e do que já está ocupado. Sem I/O.
 */
function buildDaySlots(dateStr: string, rules: RuleRow[], exceptions: ExceptionRow[], busyKnown: Interval[]): TimeSlot[] {
  const [y, m1, d] = dateStr.split('-').map(Number)
  const at = (h: number, min: number) => new TZDate(y, m1 - 1, d, h, min, 0, TZ)

  // Dia inteiro bloqueado (type 'blocked' sem horário) — nada disponível,
  // nem os horários extras, se houver.
  if (hasFullDayBlock(exceptions)) return []

  // Janelas de atendimento do dia: as regras que valem nesta data + as exceções
  // do tipo 'extra'. Um horário extra vale por si só — é o caso de um sábado
  // pontual, em que não existe availability_rules para o dia da semana.
  const defaultDuration = rules[0]?.slot_duration ?? DEFAULT_SLOT_DURATION
  const windows = [
    ...rules.map((r) => ({ start: r.start_time, end: r.end_time, duration: r.slot_duration })),
    ...exceptions
      .filter((e) => e.type === 'extra' && e.start_time && e.end_time)
      .map((e) => ({ start: e.start_time as string, end: e.end_time as string, duration: defaultDuration })),
  ]
  if (windows.length === 0) return []

  // Gerar slots das janelas (na wall-clock de São Paulo)
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

  // Bloqueios parciais do dia (type 'blocked' com horário) — ex: almoço
  // estendido, compromisso pessoal cadastrado na própria MedScale.
  const busy: Interval[] = exceptions
    .filter((e) => e.type === 'blocked' && e.start_time && e.end_time)
    .map((e) => {
      const [sh, sm] = parseHM(e.start_time as string)
      const [eh, em] = parseHM(e.end_time as string)
      return { start: at(sh, sm), end: at(eh, em) }
    })
  busy.push(...busyKnown)

  return allSlots.map((slot) => ({
    ...slot,
    available: !busy.some((interval) => overlaps(slot, interval)),
  }))
}

// Retorna todos os slots (livres e ocupados) para uma workspace numa data específica
export async function getAvailableSlots(workspaceId: string, date: Date): Promise<TimeSlot[]> {
  const supabase = createAdminClient()
  const zoned = new TZDate(date, TZ)
  const dayOfWeek = zoned.getDay() // 0=Dom ... 6=Sáb
  const dateStr = format(zoned, 'yyyy-MM-dd')

  // 1. Regras do dia da semana que valem NESTA data (repetição quinzenal etc.).
  const rules = (await loadRules(supabase, workspaceId, dayOfWeek)).filter((r) =>
    ruleAppliesOn({ day_of_week: dayOfWeek, interval_weeks: r.interval_weeks, anchor_date: r.anchor_date }, dateStr)
  )

  // 2. Exceções cadastradas para esta data. Podem ser mais de uma (ex: bloquear
  // a manhã e abrir um horário extra à noite), então lê a lista inteira —
  // `.maybeSingle()` aqui lançava erro justamente nesse caso.
  const { data: exceptions } = await supabase
    .from('availability_exceptions')
    .select('type, start_time, end_time')
    .eq('workspace_id', workspaceId)
    .eq('date', dateStr)
  const exceptionList = (exceptions ?? []) as ExceptionRow[]

  if (hasFullDayBlock(exceptionList)) return []
  if (rules.length === 0 && !hasExtraWindow(exceptionList)) return []

  const dayStart = new TZDate(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 0, 0, 0, TZ)
  const dayEnd = new TZDate(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 23, 59, 59, TZ)

  // 3. Consultas já marcadas no próprio Supabase. Sem isto, uma workspace sem
  // Google Calendar conectado oferecia ao paciente um horário em que já havia
  // outra consulta marcada — o bot agendava duas pessoas no mesmo slot.
  const { data: appointments } = await supabase
    .from('appointments')
    .select('scheduled_at, duration_min')
    .eq('workspace_id', workspaceId)
    .in('status', SLOT_BLOCKING_STATUSES)
    .gte('scheduled_at', dayStart.toISOString())
    .lte('scheduled_at', dayEnd.toISOString())

  // 4. Eventos do Google Calendar no dia (indisponibilidade real)
  const busy = [...appointmentsBusy(appointments), ...(await googleBusy(workspaceId, dayStart, dayEnd))]

  return buildDaySlots(dateStr, rules, exceptionList, busy)
}

/** Até quantos dias à frente a Clara procura horários (BOT_SLOTS_LOOKAHEAD_DAYS, padrão 35). */
export function botSlotsLookaheadDays(): number {
  const n = Number(process.env.BOT_SLOTS_LOOKAHEAD_DAYS ?? 35)
  return Number.isInteger(n) && n > 0 && n <= 120 ? n : 35
}

/**
 * Horários livres da unidade para a Clara, a partir do dia seguinte a `from`:
 * para quando achar `maxDays` dias com vaga ou chegar a `lookaheadDays`.
 * Lê regras, exceções, consultas e Google Calendar uma vez para o período
 * inteiro. Devolve { 'AAAA-MM-DD': ['08:00', ...] } só com os dias com vaga.
 */
export async function getFreeSlotsByDayForBot(
  workspaceId: string,
  from: Date,
  { maxDays = 4, lookaheadDays = botSlotsLookaheadDays() }: { maxDays?: number; lookaheadDays?: number } = {}
): Promise<Record<string, string[]>> {
  const supabase = createAdminClient()
  const today = format(new TZDate(from, TZ), 'yyyy-MM-dd')
  const firstDate = addDaysToDate(today, 1)
  const lastDate = addDaysToDate(today, lookaheadDays)

  const rules = await loadRules(supabase, workspaceId)
  const { data: exceptionRows } = await supabase
    .from('availability_exceptions')
    .select('date, type, start_time, end_time')
    .eq('workspace_id', workspaceId)
    .gte('date', firstDate)
    .lte('date', lastDate)
  const exceptions = (exceptionRows ?? []) as ExceptionRow[]
  const exceptionsOn = (date: string) => exceptions.filter((e) => e.date === date)
  const rulesOn = (date: string) =>
    rules.filter((r) => r.day_of_week !== undefined && ruleAppliesOn(r as RecurrenceRule, date))

  // Datas com alguma janela possível (regra que vale ou horário extra).
  const dates: string[] = []
  for (let i = 0; i < lookaheadDays; i++) {
    const date = addDaysToDate(firstDate, i)
    const exc = exceptionsOn(date)
    if (hasFullDayBlock(exc)) continue
    if (hasExtraWindow(exc) || rulesOn(date).length > 0) dates.push(date)
  }
  if (dates.length === 0) return {}

  const [fy, fm, fd] = dates[0].split('-').map(Number)
  const [ly, lm, ld] = dates[dates.length - 1].split('-').map(Number)
  const rangeStart = new TZDate(fy, fm - 1, fd, 0, 0, 0, TZ)
  const rangeEnd = new TZDate(ly, lm - 1, ld, 23, 59, 59, TZ)

  const { data: appointments } = await supabase
    .from('appointments')
    .select('scheduled_at, duration_min')
    .eq('workspace_id', workspaceId)
    .in('status', SLOT_BLOCKING_STATUSES)
    .gte('scheduled_at', rangeStart.toISOString())
    .lte('scheduled_at', rangeEnd.toISOString())
  // Uma consulta ao Google para o período inteiro.
  const busy = [...appointmentsBusy(appointments), ...(await googleBusy(workspaceId, rangeStart, rangeEnd))]

  const byDay: Record<string, string[]> = {}
  for (const date of dates) {
    if (Object.keys(byDay).length >= maxDays) break
    const free = buildDaySlots(date, rulesOn(date), exceptionsOn(date), busy)
      .filter((s) => s.available)
      .map((s) => format(s.start, 'HH:mm'))
    if (free.length > 0) byDay[date] = free
  }
  return byDay
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
