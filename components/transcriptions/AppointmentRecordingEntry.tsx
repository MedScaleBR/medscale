'use client'

import { useEffect, useState } from 'react'
import { RecordingButton } from './RecordingButton'
import { Loader2 } from 'lucide-react'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

interface AppointmentRecordingEntryProps {
  appointmentId: string
  patientId: string | null
  patientName: string
  patientPhone: string
}

// Resolve e valida o paciente usando a consulta salva antes de habilitar a gravação.
export function AppointmentRecordingEntry(props: AppointmentRecordingEntryProps) {
  // A mudança de consulta/paciente descarta inclusive o gravador e requisições anteriores.
  return <AppointmentPatientResolver key={JSON.stringify([props.appointmentId, props.patientId, props.patientName, props.patientPhone])} {...props} />
}

function AppointmentPatientResolver({
  appointmentId,
  patientName,
  patientPhone,
}: AppointmentRecordingEntryProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/patients/find-or-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointment_id: appointmentId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Falha ao vincular paciente')
        const patient = await res.json()
        if (!cancelled) setResolvedId(patient.id)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao vincular paciente')
      })

    return () => {
      cancelled = true
    }
  }, [appointmentId, patientName, patientPhone])

  if (error) return <p className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível vincular o paciente à consulta. Confira o cadastro e tente novamente.")}</p>

  if (!resolvedId) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Vinculando paciente...
      </span>
    )
  }

  return <RecordingButton appointmentId={appointmentId} patientId={resolvedId} />
}
