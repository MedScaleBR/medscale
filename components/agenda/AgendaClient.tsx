'use client'

import { useState } from 'react'
import { CalendarView } from './CalendarView'
import type { AppointmentFormValues } from './AppointmentModal'
import type { Database } from '@/types/database'
import type { BusyBlock } from '@/lib/google/reconcile'

type Appointment = Database['public']['Tables']['appointments']['Row']

function toIso(datetimeLocal: string) {
  return new Date(datetimeLocal).toISOString()
}

export function AgendaClient({
  initialAppointments,
  initialBusyBlocks,
  showTranscriptions,
}: {
  initialAppointments: Appointment[]
  initialBusyBlocks: BusyBlock[]
  showTranscriptions?: boolean
}) {
  const [appointments, setAppointments] = useState(initialAppointments)
  const [busyBlocks] = useState(initialBusyBlocks)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async (values: AppointmentFormValues) => {
    setError(null)
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
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Não foi possível criar a consulta.')
      throw new Error(json.error)
    }
    setAppointments((prev) => [...prev, json])
  }

  const handleUpdate = async (id: string, values: AppointmentFormValues) => {
    setError(null)
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
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Não foi possível atualizar a consulta.')
      throw new Error(json.error)
    }
    setAppointments((prev) => prev.map((a) => (a.id === id ? json : a)))
  }

  const handleDelete = async (id: string) => {
    setError(null)
    const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json()
      setError(json.error ?? 'Não foi possível cancelar a consulta.')
      throw new Error(json.error)
    }
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelado' } : a)))
  }

  return (
    <>
      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
      <CalendarView
        appointments={appointments}
        busyBlocks={busyBlocks}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        showTranscriptions={showTranscriptions}
      />
    </>
  )
}
