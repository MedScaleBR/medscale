'use client'

import { useCallback, useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, type SlotInfo, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './calendar-overrides.css'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppointmentModal, type AppointmentFormValues, type CatalogProcedureOption } from './AppointmentModal'
import type { WorkspaceOption } from './AgendaClient'
import type { Database } from '@/types/database'
import type { BusyBlock } from '@/lib/google/reconcile'

type Appointment = Database['public']['Tables']['appointments']['Row']

type CalEvent =
  | { kind: 'appointment'; id: string; title: string; start: Date; end: Date; resource: Appointment }
  | { kind: 'busy'; id: string; title: string; start: Date; end: Date; resource: BusyBlock }

// Paleta estável para colorir eventos por unidade (funciona sobre fundo branco).
const UNIT_COLORS = ['#0ea5e9', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#0d9488']
const ALL = '__all__'

const locales = { 'pt-BR': ptBR }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales,
})

const MESSAGES = {
  next: 'Próximo',
  previous: 'Anterior',
  today: 'Hoje',
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
  agenda: 'Agenda',
  date: 'Data',
  time: 'Hora',
  event: 'Consulta',
  noEventsInRange: 'Nenhuma consulta neste período.',
}

function toDatetimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface CalendarViewProps {
  appointments: Appointment[]
  busyBlocks: BusyBlock[]
  workspaces: WorkspaceOption[]
  activeWorkspaceId: string
  onCreate: (values: AppointmentFormValues) => Promise<void>
  onUpdate: (id: string, values: AppointmentFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
  showTranscriptions?: boolean
  proceduresByWorkspace?: Record<string, CatalogProcedureOption[]>
  healthPlans?: string[]
}

export function CalendarView({
  appointments,
  busyBlocks,
  workspaces,
  activeWorkspaceId,
  onCreate,
  onUpdate,
  onDelete,
  showTranscriptions,
  proceduresByWorkspace,
  healthPlans,
}: CalendarViewProps) {
  const [view, setView] = useState<View>('week')
  const [date, setDate] = useState(new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AppointmentFormValues | undefined>(undefined)
  const [unitFilter, setUnitFilter] = useState<string>(ALL)

  const multiUnit = workspaces.length > 1
  const colorByWorkspace = useMemo(() => {
    const m: Record<string, string> = {}
    workspaces.forEach((w, i) => {
      m[w.id] = UNIT_COLORS[i % UNIT_COLORS.length]
    })
    return m
  }, [workspaces])
  const nameByWorkspace = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )

  const events = useMemo<CalEvent[]>(() => {
    const matchesFilter = (wid: string | null) => unitFilter === ALL || wid === unitFilter

    const apptEvents: CalEvent[] = appointments
      .filter((a) => a.status !== 'cancelado')
      .filter((a) => matchesFilter(a.workspace_id))
      .map((a) => {
        const start = new Date(a.scheduled_at)
        const end = new Date(start.getTime() + a.duration_min * 60_000)
        const unit = a.workspace_id ? nameByWorkspace[a.workspace_id] : null
        return {
          kind: 'appointment',
          id: a.id,
          title: multiUnit && unit ? `${a.patient_name} · ${unit}` : a.patient_name,
          start,
          end,
          resource: a,
        }
      })
    const busyEvents: CalEvent[] = busyBlocks
      .filter((b) => matchesFilter(b.workspaceId))
      .map((b, i) => ({
        kind: 'busy',
        id: `busy-${i}`,
        title: b.summary,
        start: new Date(b.start),
        end: new Date(b.end),
        resource: b,
      }))
    return [...apptEvents, ...busyEvents]
  }, [appointments, busyBlocks, unitFilter, multiUnit, nameByWorkspace])

  const handleSelectSlot = useCallback(
    (slot: SlotInfo) => {
      setEditing({
        workspace_id: unitFilter !== ALL ? unitFilter : activeWorkspaceId,
        patient_name: '',
        patient_phone: '',
        scheduled_at: toDatetimeLocal(slot.start as Date),
        duration_min: 30,
        type: 'consulta',
        status: 'agendado',
        notes: '',
        price: '',
        procedure_id: null,
        health_plan: null,
      })
      setModalOpen(true)
    },
    [unitFilter, activeWorkspaceId]
  )

  const handleSelectEvent = useCallback((event: object) => {
    const e = event as CalEvent
    if (e.kind !== 'appointment') return // bloqueio do Google — só visual, não editável
    const a = e.resource
    setEditing({
      id: a.id,
      workspace_id: a.workspace_id ?? undefined,
      patient_id: a.patient_id,
      patient_name: a.patient_name,
      patient_phone: a.patient_phone,
      scheduled_at: toDatetimeLocal(new Date(a.scheduled_at)),
      duration_min: a.duration_min,
      type: a.type,
      status: a.status,
      notes: a.notes ?? '',
      price: a.price != null ? String(a.price) : '',
      procedure_id: a.procedure_id ?? null,
      health_plan: a.health_plan ?? null,
    })
    setModalOpen(true)
  }, [])

  const handleSave = async (values: AppointmentFormValues) => {
    if (values.id) {
      await onUpdate(values.id, values)
    } else {
      await onCreate(values)
    }
  }

  const modalProcedures = editing?.workspace_id
    ? (proceduresByWorkspace?.[editing.workspace_id] ?? [])
    : []

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      {multiUnit && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Select value={unitFilter} onValueChange={(v) => v && setUnitFilter(v)}>
            <SelectTrigger className="w-56">
              <SelectValue>
                {(value) => (value === ALL ? 'Todas as unidades' : nameByWorkspace[value as string] ?? value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as unidades</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {workspaces.map((w) => (
              <span key={w.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorByWorkspace[w.id] }}
                />
                {w.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 680 }}
        view={view}
        onView={setView}
        date={date}
        onNavigate={setDate}
        selectable
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        messages={MESSAGES}
        culture="pt-BR"
        eventPropGetter={(event) => {
          const e = event as CalEvent
          if (e.kind === 'busy') {
            return {
              style: {
                backgroundColor: 'var(--navy-06)',
                color: 'var(--navy)',
                border: 'none',
                borderRadius: 6,
                opacity: 0.7,
                cursor: 'default',
              },
              className: 'pointer-events-none',
            }
          }
          const a = e.resource
          // Cor por unidade quando há mais de uma; senão, o realce bot/manual.
          const unitColor = a.workspace_id ? colorByWorkspace[a.workspace_id] : undefined
          const bg = multiUnit && unitColor ? unitColor : a.source === 'bot' ? 'var(--cyan)' : 'var(--navy)'
          return {
            style: {
              backgroundColor: bg,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              // realce sutil para consultas marcadas pela Maria
              boxShadow: a.source === 'bot' ? 'inset 3px 0 0 rgba(255,255,255,0.7)' : undefined,
            },
          }
        }}
      />

      <AppointmentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialValues={editing}
        workspaces={workspaces}
        onSave={handleSave}
        onDelete={
          editing?.id
            ? async () => {
                try {
                  await onDelete(editing.id!)
                  setModalOpen(false)
                } catch {
                  // erro já é mostrado pelo AgendaClient — modal fica aberto
                }
              }
            : undefined
        }
        showTranscriptions={showTranscriptions}
        procedures={modalProcedures}
        healthPlans={healthPlans}
      />
    </div>
  )
}
