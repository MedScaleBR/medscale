'use client'

import { useCallback, useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, type SlotInfo, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './calendar-overrides.css'
import { AppointmentModal, type AppointmentFormValues } from './AppointmentModal'
import type { Database } from '@/types/database'

type Appointment = Database['public']['Tables']['appointments']['Row']

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
  onCreate: (values: AppointmentFormValues) => Promise<void>
  onUpdate: (id: string, values: AppointmentFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function CalendarView({ appointments, onCreate, onUpdate, onDelete }: CalendarViewProps) {
  const [view, setView] = useState<View>('week')
  const [date, setDate] = useState(new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AppointmentFormValues | undefined>(undefined)

  const events = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== 'cancelado')
        .map((a) => {
          const start = new Date(a.scheduled_at)
          const end = new Date(start.getTime() + a.duration_min * 60_000)
          return { id: a.id, title: a.patient_name, start, end, resource: a }
        }),
    [appointments]
  )

  const handleSelectSlot = useCallback((slot: SlotInfo) => {
    setEditing({
      patient_name: '',
      patient_phone: '',
      scheduled_at: toDatetimeLocal(slot.start as Date),
      duration_min: 30,
      type: 'consulta',
      status: 'agendado',
      notes: '',
      price: '',
    })
    setModalOpen(true)
  }, [])

  const handleSelectEvent = useCallback((event: object) => {
    const a = (event as { resource: Appointment }).resource
    setEditing({
      id: a.id,
      patient_name: a.patient_name,
      patient_phone: a.patient_phone,
      scheduled_at: toDatetimeLocal(new Date(a.scheduled_at)),
      duration_min: a.duration_min,
      type: a.type,
      status: a.status,
      notes: a.notes ?? '',
      price: a.price != null ? String(a.price) : '',
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

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
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
          const a = (event as { resource: Appointment }).resource
          return {
            style: {
              backgroundColor: a.source === 'bot' ? 'var(--cyan)' : 'var(--navy)',
              color: a.source === 'bot' ? 'var(--navy-dark)' : '#fff',
              border: 'none',
              borderRadius: 6,
            },
          }
        }}
      />

      <AppointmentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialValues={editing}
        onSave={handleSave}
        onDelete={editing?.id ? async () => { await onDelete(editing.id!); setModalOpen(false) } : undefined}
      />
    </div>
  )
}
