'use client'

import { useState } from 'react'
import { CalendarView } from './CalendarView'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackAppointmentCreatedManual, trackAppointmentStatusChanged } from '@/lib/analytics/posthog'
import type { AppointmentFormValues, CatalogProcedureOption } from './AppointmentModal'
import type { InsurerOption } from '@/components/billing/PatientInsurances'
import type { Database } from '@/types/database'
import type { BusyBlock } from '@/lib/google/reconcile'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

type Appointment = Database['public']['Tables']['appointments']['Row']

export interface WorkspaceOption {
  id: string
  name: string
}

function toIso(datetimeLocal: string) {
  return new Date(datetimeLocal).toISOString()
}

// Campos de faturamento TISS — só vão no corpo quando o usuário escolheu o
// atendimento no modo faturamento (billing_type != null). Sem isso a rota
// segue o caminho antigo do health_plan em texto livre.
function billingBody(values: AppointmentFormValues) {
  if (!values.billing_type) return {}
  if (values.billing_type === 'particular' || !values.billing) return { billing_type: 'particular' }
  return {
    billing_type: 'convenio',
    insurer_id: values.billing.insurer_id,
    patient_insurance_id: values.billing.patient_insurance_id,
    insurer_procedure_id: values.billing.insurer_procedure_id,
    authorization_number: values.billing.authorization_number || null,
    authorization_date: values.billing.authorization_date || null,
  }
}

export function AgendaClient({
  initialAppointments,
  initialBusyBlocks,
  workspaces,
  activeWorkspaceId,
  showTranscriptions,
  proceduresByWorkspace,
  healthPlans,
  billingInsurers,
}: {
  initialAppointments: Appointment[]
  initialBusyBlocks: BusyBlock[]
  workspaces: WorkspaceOption[]
  activeWorkspaceId: string
  showTranscriptions?: boolean
  proceduresByWorkspace?: Record<string, CatalogProcedureOption[]>
  healthPlans?: string[]
  billingInsurers?: InsurerOption[]
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
        ...billingBody(values),
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
        ...billingBody(values),
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
      {error && <p className="mb-3 text-sm text-red-500">{friendlyErrorMessage(error, "Não foi possível salvar a alteração na agenda. Tente novamente.")}</p>}
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
        billingInsurers={billingInsurers}
      />
    </>
  )
}
