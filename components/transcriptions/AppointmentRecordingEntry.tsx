'use client'

import { useEffect, useState } from 'react'
import { RecordingButton } from './RecordingButton'
import { Loader2 } from 'lucide-react'

interface AppointmentRecordingEntryProps {
  appointmentId: string
  patientId: string | null
  patientName: string
  patientPhone: string
}

// Consultas criadas pela Agenda nem sempre têm patient_id vinculado (o
// formulário guarda patient_name/patient_phone em texto livre) — resolve (ou
// cria) o paciente correspondente por telefone antes de habilitar a gravação.
export function AppointmentRecordingEntry({
  appointmentId,
  patientId,
  patientName,
  patientPhone,
}: AppointmentRecordingEntryProps) {
  const [resolvedId, setResolvedId] = useState(patientId)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (resolvedId || !patientName || !patientPhone) return

    let cancelled = false
    fetch('/api/patients/find-or-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: patientName, phone: patientPhone }),
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
  }, [resolvedId, patientName, patientPhone])

  if (error) return <p className="text-xs text-red-600">{error}</p>

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
