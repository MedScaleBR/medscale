'use client'

import { useState } from 'react'
import { CalendarView } from './CalendarView'
import type { AppointmentFormValues } from './AppointmentModal'
import type { Database } from '@/types/database'

type Appointment = Database['public']['Tables']['appointments']['Row']

function toIso(datetimeLocal: string) {
  return new Date(datetimeLocal).toISOString()
}

export function AgendaClient({
  initialAppointments,
  showTranscriptions,
}: {
  initialAppointments: Appointment[]
  showTranscriptions?: boolean
}) {
  const [appointments, setAppointments] = useState(initialAppointments)

  const handleCreate = async (values: AppointmentFormValues) => {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: values.patient_name,
        patient_phone: values.patient_phone,
        scheduled_at: toIso(values.scheduled_at),
        duration_min: values.duration_min,
        type: values.type,
        status: values.status,
        notes: values.notes || null,
        price: values.price ? Number(values.price) : null,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setAppointments((prev) => [...prev, created])
    }
  }

  const handleUpdate = async (id: string, values: AppointmentFormValues) => {
    const res = await fetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: values.patient_name,
        patient_phone: values.patient_phone,
        scheduled_at: toIso(values.scheduled_at),
        duration_min: values.duration_min,
        type: values.type,
        status: values.status,
        notes: values.notes || null,
        price: values.price ? Number(values.price) : null,
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)))
    }
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelado' } : a)))
    }
  }

  return (
    <CalendarView
      appointments={appointments}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      showTranscriptions={showTranscriptions}
    />
  )
}
