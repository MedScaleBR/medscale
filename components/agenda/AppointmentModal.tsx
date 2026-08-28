'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppointmentRecordingEntry } from '@/components/transcriptions/AppointmentRecordingEntry'
import type { AppointmentType, AppointmentStatus } from '@/types/database'

export interface CatalogProcedureOption {
  id: string
  name: string
  default_price: number
}

export interface AppointmentFormValues {
  id?: string
  patient_id?: string | null
  patient_name: string
  patient_phone: string
  scheduled_at: string // datetime-local value
  duration_min: number
  type: AppointmentType
  status: AppointmentStatus
  notes: string
  price: string
  procedure_id: string | null
  /** Convênio atendido, ou null = particular. */
  health_plan: string | null
}

interface AppointmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<AppointmentFormValues>
  onSave: (values: AppointmentFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  showTranscriptions?: boolean
  procedures?: CatalogProcedureOption[]
  healthPlans?: string[]
}

const EMPTY: AppointmentFormValues = {
  patient_name: '',
  patient_phone: '',
  scheduled_at: '',
  duration_min: 30,
  type: 'consulta',
  status: 'agendado',
  notes: '',
  price: '',
  procedure_id: null,
  health_plan: null,
}

const NO_PROCEDURE = '__none__'
const PARTICULAR = '__particular__'

export function AppointmentModal({
  open,
  onOpenChange,
  initialValues,
  onSave,
  onDelete,
  showTranscriptions,
  procedures,
  healthPlans,
}: AppointmentModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <AppointmentForm
            initialValues={initialValues}
            onSave={onSave}
            onDelete={onDelete}
            onOpenChange={onOpenChange}
            showTranscriptions={showTranscriptions}
            procedures={procedures ?? []}
            healthPlans={healthPlans ?? []}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface AppointmentFormProps {
  initialValues?: Partial<AppointmentFormValues>
  onSave: (values: AppointmentFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  onOpenChange: (open: boolean) => void
  showTranscriptions?: boolean
  procedures: CatalogProcedureOption[]
  healthPlans: string[]
}

function AppointmentForm({ initialValues, onSave, onDelete, onOpenChange, showTranscriptions, procedures, healthPlans }: AppointmentFormProps) {
  const [values, setValues] = useState<AppointmentFormValues>({ ...EMPTY, ...initialValues })
  const [saving, setSaving] = useState(false)
  const isConvenio = values.health_plan != null

  const onHealthPlanChange = (choice: string | null) => {
    if (!choice || choice === PARTICULAR) {
      setValues((v) => ({ ...v, health_plan: null }))
      return
    }
    // Consulta por convênio não entra no ciclo de receita — zera valor e
    // procedimento.
    setValues((v) => ({ ...v, health_plan: choice, price: '', procedure_id: null }))
  }

  const onProcedureChange = (id: string | null) => {
    if (!id || id === NO_PROCEDURE) {
      setValues((v) => ({ ...v, procedure_id: null }))
      return
    }
    const proc = procedures.find((p) => p.id === id)
    setValues((v) => ({
      ...v,
      procedure_id: id,
      // Preenche o valor com o preço de tabela; o usuário ainda pode ajustar.
      price: proc ? String(proc.default_price) : v.price,
    }))
  }

  const handleSave = async () => {
    if (!values.patient_name || !values.patient_phone || !values.scheduled_at) return
    setSaving(true)
    try {
      await onSave(values)
      onOpenChange(false)
    } catch {
      // erro já é mostrado pelo AgendaClient — modal fica aberto pro usuário tentar de novo
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{values.id ? 'Editar consulta' : 'Nova consulta'}</DialogTitle>
      </DialogHeader>

      {showTranscriptions && values.id && values.patient_name && values.patient_phone && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--navy-06)] bg-[var(--navy-06)]/20 p-3">
          <span className="text-xs text-gray-500">Transcrição da consulta</span>
          <AppointmentRecordingEntry
            appointmentId={values.id}
            patientId={values.patient_id ?? null}
            patientName={values.patient_name}
            patientPhone={values.patient_phone}
          />
        </div>
      )}

      <div className="space-y-3">
          <div>
            <Label htmlFor="patient_name">Nome do paciente</Label>
            <Input
              id="patient_name"
              value={values.patient_name}
              onChange={(e) => setValues((v) => ({ ...v, patient_name: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="patient_phone">Telefone (E.164)</Label>
            <Input
              id="patient_phone"
              placeholder="+5511999999999"
              value={values.patient_phone}
              onChange={(e) => setValues((v) => ({ ...v, patient_phone: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="scheduled_at">Data e hora</Label>
            <Input
              id="scheduled_at"
              type="datetime-local"
              value={values.scheduled_at}
              onChange={(e) => setValues((v) => ({ ...v, scheduled_at: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Duração (min)</Label>
              <Input
                type="number"
                value={values.duration_min}
                onChange={(e) => setValues((v) => ({ ...v, duration_min: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={values.type} onValueChange={(t) => setValues((v) => ({ ...v, type: t as AppointmentType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consulta">Consulta</SelectItem>
                  <SelectItem value="retorno">Retorno</SelectItem>
                  <SelectItem value="avaliacao">Avaliação</SelectItem>
                  <SelectItem value="procedimento">Procedimento</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {healthPlans.length > 0 && (
            <div>
              <Label>Atendimento</Label>
              <Select value={values.health_plan ?? PARTICULAR} onValueChange={onHealthPlanChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Particular">
                    {(v) => (!v || v === PARTICULAR ? 'Particular' : String(v))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PARTICULAR}>Particular</SelectItem>
                  {healthPlans.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {plan}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isConvenio && (
                <p className="mt-1 text-xs text-gray-400">
                  Consulta por convênio — não entra no ciclo de receita.
                </p>
              )}
            </div>
          )}
          {!isConvenio && procedures.length > 0 && (
            <div>
              <Label>Procedimento</Label>
              <Select value={values.procedure_id ?? NO_PROCEDURE} onValueChange={onProcedureChange}>
                <SelectTrigger>
                  {/* base-ui renderiza o value cru (id / "__none__") sem uma
                      função aqui pra resolver o rótulo do item selecionado. */}
                  <SelectValue placeholder="Sem procedimento">
                    {(id) =>
                      !id || id === NO_PROCEDURE
                        ? 'Sem procedimento'
                        : (procedures.find((p) => p.id === id)?.name ?? 'Sem procedimento')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROCEDURE}>Sem procedimento</SelectItem>
                  {procedures.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — R${p.default_price.toFixed(0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!isConvenio && (
            <div>
              <Label htmlFor="price">Valor (R$)</Label>
              <Input
                id="price"
                type="number"
                min={0}
                placeholder="Opcional — usado no ciclo de receita"
                value={values.price}
                onChange={(e) => setValues((v) => ({ ...v, price: e.target.value }))}
              />
            </div>
          )}
          <div>
            <Label>Status</Label>
            <Select
              value={values.status}
              onValueChange={(s) => setValues((v) => ({ ...v, status: s as AppointmentStatus }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agendado">Agendado</SelectItem>
                <SelectItem value="confirmado">Confirmado</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
                <SelectItem value="no_show">No-show</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              value={values.notes}
              onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete && values.id ? (
            <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={onDelete}>
              Cancelar consulta
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
      </DialogFooter>
    </>
  )
}
