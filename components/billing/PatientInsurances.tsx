'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface InsurerOption {
  id: string
  name: string
}

export interface PatientInsuranceRow {
  id: string
  patient_id: string
  insurer_id: string
  card_number: string
  plan_name: string | null
  valid_until: string | null
  is_primary: boolean
  health_insurers: { name: string } | null
}

const EMPTY = { insurer_id: '', card_number: '', plan_name: '', valid_until: '', is_primary: false }

// Formulário de convênio do paciente — usado na página do paciente e no
// "cadastrar novo" do agendamento.
export function PatientInsuranceDialog({
  open,
  onOpenChange,
  patientId,
  insurers,
  editing,
  defaultInsurerId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  insurers: InsurerOption[]
  editing: PatientInsuranceRow | null
  defaultInsurerId?: string
  onSaved: (row: PatientInsuranceRow) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <InsuranceForm
            patientId={patientId}
            insurers={insurers}
            editing={editing}
            defaultInsurerId={defaultInsurerId}
            onSaved={(row) => {
              onSaved(row)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InsuranceForm({
  patientId,
  insurers,
  editing,
  defaultInsurerId,
  onSaved,
}: {
  patientId: string
  insurers: InsurerOption[]
  editing: PatientInsuranceRow | null
  defaultInsurerId?: string
  onSaved: (row: PatientInsuranceRow) => void
}) {
  const [form, setForm] = useState(
    editing
      ? {
          insurer_id: editing.insurer_id,
          card_number: editing.card_number,
          plan_name: editing.plan_name ?? '',
          valid_until: editing.valid_until ?? '',
          is_primary: editing.is_primary,
        }
      : { ...EMPTY, insurer_id: defaultInsurerId ?? '' },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const insurerNames = Object.fromEntries(insurers.map((i) => [i.id, i.name]))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/billing/patients/${patientId}/insurances`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(editing ? { insurance_id: editing.id } : {}), ...form }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar.')
        return
      }
      onSaved(data as PatientInsuranceRow)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Editar convênio' : 'Novo convênio do paciente'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Operadora</Label>
          <Select
            items={insurerNames}
            value={form.insurer_id}
            onValueChange={(v) => v && setForm((f) => ({ ...f, insurer_id: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {insurers.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="card_number">Número da carteirinha</Label>
          <Input
            id="card_number"
            maxLength={20}
            value={form.card_number}
            onChange={(e) => setForm((f) => ({ ...f, card_number: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="plan_name">Plano</Label>
            <Input
              id="plan_name"
              value={form.plan_name}
              onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="valid_until">Validade</Label>
            <Input
              id="valid_until"
              type="date"
              value={form.valid_until}
              onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
            />
          </div>
        </div>
        <label className="flex items-center justify-between pt-1">
          <span className="text-sm text-gray-700">Convênio principal</span>
          <Switch checked={form.is_primary} onCheckedChange={(v) => setForm((f) => ({ ...f, is_primary: v }))} />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <DialogFooter>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </>
  )
}

export function PatientInsurances({
  patientId,
  insurers,
  initialInsurances,
}: {
  patientId: string
  insurers: InsurerOption[]
  initialInsurances: PatientInsuranceRow[]
}) {
  const [rows, setRows] = useState(initialInsurances)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PatientInsuranceRow | null>(null)

  const onSaved = (saved: PatientInsuranceRow) =>
    setRows((prev) => {
      const next = prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved]
      // O servidor desmarca os outros principais; espelha aqui.
      return saved.is_primary ? next.map((r) => (r.id === saved.id ? r : { ...r, is_primary: false })) : next
    })

  const remove = async (row: PatientInsuranceRow) => {
    if (!confirm('Remover este convênio do paciente? Guias já geradas não são afetadas.')) return
    const res = await fetch(`/api/billing/patients/${patientId}/insurances?insurance_id=${row.id}`, { method: 'DELETE' })
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== row.id))
  }

  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Convênios</h2>
        {insurers.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
            className="gap-1 text-[var(--cyan-dark)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          {insurers.length === 0 ? 'Nenhuma operadora cadastrada em Configurações → Convênios.' : 'Paciente particular.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--navy-06)]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  {r.health_insurers?.name ?? 'Operadora'}
                  {r.is_primary && (
                    <Badge className="border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]">Principal</Badge>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  Carteirinha {r.card_number}
                  {r.plan_name ? ` · ${r.plan_name}` : ''}
                  {r.valid_until ? ` · válida até ${r.valid_until.split('-').reverse().join('/')}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  onClick={() => {
                    setEditing(r)
                    setDialogOpen(true)
                  }}
                  className="mr-3 text-gray-400 hover:text-gray-700"
                  aria-label="Editar convênio"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(r)} className="text-gray-400 hover:text-red-600" aria-label="Remover convênio">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PatientInsuranceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
        insurers={insurers}
        editing={editing}
        onSaved={onSaved}
      />
    </div>
  )
}
