'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PatientInsuranceDialog, type InsurerOption, type PatientInsuranceRow } from './PatientInsurances'
import { formatCents } from './money'

export interface AppointmentBillingValues {
  insurer_id: string
  patient_insurance_id: string | null
  insurer_procedure_id: string | null
  authorization_number: string
  authorization_date: string
}

interface ProcedureOption {
  id: string
  tuss_code: string
  description: string
  price_cents: number
}

const NONE = '__none__'

// Campos de convênio do agendamento: carteirinha (do paciente, filtrada pela
// operadora — ou cadastrar uma nova ali mesmo), procedimento TUSS da
// operadora e autorização (senha), ambos opcionais. O que faltar vira
// missing_fields na guia e pode ser completado em /faturamento.
export function AppointmentBillingFields({
  patientId,
  insurers,
  value,
  onChange,
}: {
  patientId: string | null
  insurers: InsurerOption[]
  value: AppointmentBillingValues
  onChange: (next: AppointmentBillingValues) => void
}) {
  const [cards, setCards] = useState<PatientInsuranceRow[]>([])
  const [procedures, setProcedures] = useState<ProcedureOption[]>([])
  const [newCardOpen, setNewCardOpen] = useState(false)

  useEffect(() => {
    if (!patientId) return
    let cancelled = false
    fetch(`/api/billing/patients/${patientId}/insurances`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PatientInsuranceRow[]) => !cancelled && setCards(rows))
    return () => {
      cancelled = true
    }
  }, [patientId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/billing/insurers/${value.insurer_id}/procedures`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProcedureOption[]) => !cancelled && setProcedures(rows))
    return () => {
      cancelled = true
    }
  }, [value.insurer_id])

  const insurerCards = cards.filter((c) => c.insurer_id === value.insurer_id)

  // Sem carteirinha escolhida, pré-seleciona a principal (ou a única) desta operadora.
  useEffect(() => {
    if (value.patient_insurance_id || insurerCards.length === 0) return
    const preferred = insurerCards.find((c) => c.is_primary) ?? (insurerCards.length === 1 ? insurerCards[0] : null)
    if (preferred) onChange({ ...value, patient_insurance_id: preferred.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insurerCards.length, value.insurer_id])

  const cardLabels = Object.fromEntries([
    [NONE, 'Sem carteirinha'],
    ...insurerCards.map((c) => [c.id, `${c.card_number}${c.plan_name ? ` · ${c.plan_name}` : ''}`]),
  ])
  const procedureLabels = Object.fromEntries([
    [NONE, 'Definir depois'],
    ...procedures.map((p) => [p.id, `${p.tuss_code} — ${p.description}`]),
  ])

  return (
    <div className="ph-no-capture ph-mask space-y-3 rounded-lg border border-[var(--navy-06)] p-3">
      <div>
        <div className="flex items-center justify-between">
          <Label>Carteirinha</Label>
          {patientId && (
            <button
              type="button"
              onClick={() => setNewCardOpen(true)}
              className="flex items-center gap-1 text-xs text-[var(--cyan-dark)] hover:underline"
            >
              <Plus className="h-3 w-3" />
              Nova carteirinha
            </button>
          )}
        </div>
        {patientId ? (
          <Select
            items={cardLabels}
            value={value.patient_insurance_id ?? NONE}
            onValueChange={(v) => onChange({ ...value, patient_insurance_id: !v || v === NONE ? null : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="ph-no-capture ph-mask">
              <SelectItem value={NONE}>Sem carteirinha</SelectItem>
              {insurerCards.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {cardLabels[c.id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
            Consulta sem paciente vinculado — a carteirinha é preenchida depois, na guia.
          </p>
        )}
      </div>

      <div>
        <Label>Procedimento TUSS</Label>
        <Select
          items={procedureLabels}
          value={value.insurer_procedure_id ?? NONE}
          onValueChange={(v) => onChange({ ...value, insurer_procedure_id: !v || v === NONE ? null : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Definir depois</SelectItem>
            {procedures.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.tuss_code} — {p.description} · {formatCents(p.price_cents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="authorization_number">Código de autorização</Label>
          <Input
            id="authorization_number"
            maxLength={20}
            placeholder="Opcional"
            value={value.authorization_number}
            onChange={(e) => onChange({ ...value, authorization_number: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="authorization_date">Data da autorização</Label>
          <Input
            id="authorization_date"
            type="date"
            value={value.authorization_date}
            onChange={(e) => onChange({ ...value, authorization_date: e.target.value })}
          />
        </div>
      </div>

      {patientId && (
        <PatientInsuranceDialog
          open={newCardOpen}
          onOpenChange={setNewCardOpen}
          patientId={patientId}
          insurers={insurers}
          editing={null}
          defaultInsurerId={value.insurer_id}
          onSaved={(row) => {
            setCards((prev) => [...prev, row])
            if (row.insurer_id === value.insurer_id) onChange({ ...value, patient_insurance_id: row.id })
          }}
        />
      )}
    </div>
  )
}
