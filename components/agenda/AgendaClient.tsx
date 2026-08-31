'use client'

import { useState } from 'react'
import { CalendarView } from './CalendarView'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackAppointmentCreatedManual, trackAppointmentStatusChanged } from '@/lib/analytics/posthog'
import type { AppointmentFormValues, CatalogProcedureOption } from './AppointmentModal'
import type { Database } from '@/types/database'
import type { BusyBlock } from '@/lib/google/reconcile'

type Appointment = Database['public']['Tables']['appointments']['Row']

export interface WorkspaceOption {
  id: string
  name: string
}

function toIso(datetimeLocal: string) {
  return new Date(datetimeLocal).toISOString()
}

export function AgendaClient({
  initialAppointments,
  initialBusyBlocks,
  workspaces,
  activeWorkspaceId,
  showTranscriptions,
  proceduresByWorkspace,
  healthPlans,
}: {
  initialAppointments: Appointment[]
  initialBusyBlocks: BusyBlock[]
  workspaces: WorkspaceOption[]
  activeWorkspaceId: string
  showTranscriptions?: boolean
  proceduresByWorkspace?: Record<string, CatalogProcedureOption[]>
  healthPlans?: string[]
}) {
  const [appointments, setAppointments] = useState(initialAppointments)
  const [busyBlocks] = useState(initialBusyBlocks)
  const [error, setError] = useState<string | null>(null)
  const analyticsBase = useAnalyticsBase()

  const handleCreate = async (values: AppointmentFormValues) => {
    setError(null)
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: values.workspace_id ?? activeWorkspaceId,
        patient_name: values.patient_name,
        patient_phone: values.patient_phone,
        scheduled_at: toIso(values.scheduled_at),
        duration_min: values.duration_min,
        type: values.type,
        status: values.status,
        notes: values.notes || null,
        price: values.price ? Number(values.price) : null,
        procedure_id: values.procedure_id || null,
        health_plan: values.health_plan || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Não foi possível criar a consulta.')
      throw new Error(json.error)
    }
    setAppointments((prev) => [...prev, json])
    trackAppointmentCreatedManual(analyticsBase)
  }

  const handleUpdate = async (id: string, values: AppointmentFormValues) => {
    setError(null)
    const prevStatus = appointments.find((a) => a.id === id)?.status
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
        procedure_id: values.procedure_id || null,
        health_plan: values.health_plan || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Não foi possível atualizar a consulta.')
      throw new Error(json.error)
    }
    setAppointments((prev) => prev.map((a) => (a.id === id ? json : a)))
    if (prevStatus && json.status && prevStatus !== json.status) {
      trackAppointmentStatusChanged({
        ...analyticsBase,
        from_status: prevStatus,
        to_status: json.status,
      })
    }
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
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        showTranscriptions={showTranscriptions}
        proceduresByWorkspace={proceduresByWorkspace}
        healthPlans={healthPlans}
      />
    </>
  )
}
