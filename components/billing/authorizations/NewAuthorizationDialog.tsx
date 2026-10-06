'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AUTHORIZATION_TYPE_LABELS } from '@/lib/billing/authorizations/constants'
import type { ProfessionalOption } from '@/lib/billing/authorizations/payload'
import type { AuthorizationType } from '@/lib/billing/authorizations/types'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import type { InsurerOption, PatientInsuranceRow } from '../PatientInsurances'
import { PatientSearch, type PatientHit } from './PatientSearch'

type CreatableType = Exclude<AuthorizationType, 'opme_request'>
const CREATABLE: CreatableType[] = ['sp_sadt_request', 'hospitalization_request']
const NONE = '__none__'

export function formatProfessional(p: ProfessionalOption): string {
  return p.crm ? `${p.full_name} — CRM ${p.crm}${p.crm_uf ? `/${p.crm_uf}` : ''}` : p.full_name
}

export function NewAuthorizationDialog({
  open,
  onOpenChange,
  insurers,
  defaults,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  insurers: InsurerOption[]
  defaults?: { type?: CreatableType; appointmentId?: string }
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ph-no-capture ph-mask sm:max-w-md">
        {open && (
          <NewAuthorizationForm
            insurers={insurers}
            defaults={defaults}
            onCancel={() => onOpenChange(false)}
            onCreated={(id) => {
              onOpenChange(false)
              onCreated(id)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewAuthorizationForm({
  insurers,
  defaults,
  onCancel,
  onCreated,
}: {
  insurers: InsurerOption[]
  defaults?: { type?: CreatableType; appointmentId?: string }
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const appointmentId = defaults?.appointmentId
  const [type, setType] = useState<CreatableType>(defaults?.type ?? 'sp_sadt_request')
  const [patient, setPatient] = useState<PatientHit | null>(null)
  const [insurances, setInsurances] = useState<PatientInsuranceRow[] | null>(null)
  // Valor do seletor de operadora: id da carteirinha ou, sem carteirinha, id da operadora.
  const [insuranceKey, setInsuranceKey] = useState('')
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([])
  const [professionalId, setProfessionalId] = useState(NONE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/authorizations/professionals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setProfessionals(d.professionals ?? []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const pickPatient = (p: PatientHit | null) => {
    setPatient(p)
    setInsuranceKey('')
    setInsurances(null)
    if (!p) return
    fetch(`/api/billing/patients/${p.id}/insurances`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PatientInsuranceRow[]) => {
        setInsurances(rows)
        if (rows.length > 0) setInsuranceKey(rows[0].id)
      })
      .catch(() => setInsurances([]))
  }

  const hasCards = (insurances?.length ?? 0) > 0
  const insuranceLabels: Record<string, string> = hasCards
    ? Object.fromEntries(
        (insurances ?? []).map((i) => [i.id, `${i.health_insurers?.name ?? 'Operadora'} — ${i.card_number}`]),
      )
    : Object.fromEntries(insurers.map((i) => [i.id, i.name]))
  const professionalLabels: Record<string, string> = {
    [NONE]: appointmentId ? 'Médico do agendamento' : 'Sem profissional',
    ...Object.fromEntries(professionals.map((p) => [p.id, formatProfessional(p)])),
  }
  const typeLabels = Object.fromEntries(CREATABLE.map((t) => [t, AUTHORIZATION_TYPE_LABELS[t]]))

  const canSubmit = appointmentId ? true : Boolean(patient && insuranceKey)

  const submit = async () => {
    setSaving(true)
    setError(null)
    const body: Record<string, string> = { type }
    if (professionalId !== NONE) body.professional_id = professionalId
    if (appointmentId) {
      body.appointment_id = appointmentId
    } else if (patient) {
      body.patient_id = patient.id
      const card = insurances?.find((i) => i.id === insuranceKey)
      if (card) {
        body.insurer_id = card.insurer_id
        body.patient_insurance_id = card.id
      } else {
        body.insurer_id = insuranceKey
      }
    }
    try {
      const res = await fetch('/api/billing/authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.id) {
        setError(friendlyErrorMessage(data?.error))
        return
      }
      onCreated(data.id)
    } catch (e) {
      setError(friendlyErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nova autorização</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select items={typeLabels} value={type} onValueChange={(v) => v && setType(v as CreatableType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATABLE.map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTHORIZATION_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-gray-400">O anexo OPME é criado dentro de uma autorização já existente.</p>
        </div>

        {appointmentId ? (
          <p className="rounded-lg bg-[var(--navy-06)]/50 px-3 py-2 text-xs text-gray-600">
            A partir do agendamento. Paciente, operadora e carteirinha vêm dele.
          </p>
        ) : (
          <>
            <div>
              <Label htmlFor="new_auth_patient" className="text-xs">
                Paciente
              </Label>
              <PatientSearch id="new_auth_patient" value={patient} onChange={pickPatient} />
            </div>
            {patient && insurances !== null && (
              <div>
                <Label className="text-xs">{hasCards ? 'Operadora / carteirinha' : 'Operadora'}</Label>
                <Select items={insuranceLabels} value={insuranceKey} onValueChange={(v) => setInsuranceKey(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(insuranceLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!hasCards && (
                  <p className="mt-1 text-xs text-gray-400">
                    Este paciente não tem carteirinha cadastrada. A carteirinha ficará como pendência.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <Label className="text-xs">Profissional solicitante (opcional)</Label>
          <Select items={professionalLabels} value={professionalId} onValueChange={(v) => setProfessionalId(v ?? NONE)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(professionalLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={saving || !canSubmit}>
          {saving ? 'Criando…' : 'Criar autorização'}
        </Button>
      </DialogFooter>
    </>
  )
}
