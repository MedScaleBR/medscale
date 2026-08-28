'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RevenuePaymentMethod, RevenuePaymentStatus } from '@/types/database'
import type { RevenueTotals } from '@/lib/revenue/summary'

export interface RevenueCycleEntry {
  id: string
  amount: number | string
  payment_status: RevenuePaymentStatus
  payment_method: RevenuePaymentMethod | null
  paid_at: string | null
  due_date: string | null
  procedure_name: string | null
  installments: number
  appointments: { scheduled_at: string; patient_name: string; status: string } | null
  patients: { full_name: string } | null
}

export interface HealthPlanConsultation {
  id: string
  scheduled_at: string
  patient_name: string
  health_plan: string
}

type EntryRow = RevenueCycleEntry

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

const STATUS: Record<RevenuePaymentStatus, { label: string; style: string }> = {
  pending: { label: 'Agendada', style: 'bg-[var(--navy-06)] text-[var(--navy)]' },
  realized: { label: 'Aguardando pagamento', style: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Pago', style: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelada', style: 'bg-red-100 text-red-600' },
  refunded: { label: 'Reembolsada', style: 'bg-red-100 text-red-600' },
}

const METHODS: { value: RevenuePaymentMethod; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'outro', label: 'Outro' },
]
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]))

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function patientName(e: EntryRow): string {
  return e.patients?.full_name ?? e.appointments?.patient_name ?? 'Paciente'
}
function apptTime(e: EntryRow): string {
  const iso = e.appointments?.scheduled_at
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export function RevenueCycleClient({
  initialEntries,
  monthTotals,
  isOwner,
  healthPlanConsultations,
  healthPlanMonthCount,
}: {
  initialEntries: EntryRow[]
  monthTotals: RevenueTotals | null
  isOwner: boolean
  healthPlanConsultations: HealthPlanConsultation[]
  healthPlanMonthCount: number
}) {
  const [entries, setEntries] = useState(initialEntries)
  const [confirming, setConfirming] = useState<EntryRow | null>(null)
  const [method, setMethod] = useState<RevenuePaymentMethod>('pix')
  const [saving, setSaving] = useState(false)
  const [planFilter, setPlanFilter] = useState<string>('all')

  const plansPresent = [...new Set(healthPlanConsultations.map((c) => c.health_plan))].sort()
  const filteredConsultations =
    planFilter === 'all'
      ? healthPlanConsultations
      : healthPlanConsultations.filter((c) => c.health_plan === planFilter)

  const openConfirm = (e: EntryRow) => {
    setConfirming(e)
    setMethod('pix')
  }

  const confirmPayment = async () => {
    if (!confirming) return
    setSaving(true)
    try {
      const res = await fetch(`/api/revenue-entries/${confirming.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: method }),
      })
      if (res.ok) {
        const updated = (await res.json()) as { payment_method: RevenuePaymentMethod; paid_at: string }
        setEntries((prev) =>
          prev.map((x) =>
            x.id === confirming.id
              ? { ...x, payment_status: 'paid', payment_method: updated.payment_method, paid_at: updated.paid_at }
              : x
          )
        )
        setConfirming(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const pendingCount = entries.filter((e) => e.payment_status === 'realized').length

  return (
    <div className="space-y-6">
      {isOwner && monthTotals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Previsto no mês" value={formatBRL(monthTotals.projected)} />
          <Kpi label="Realizado" value={formatBRL(monthTotals.realized)} />
          <Kpi label="Recebido" value={formatBRL(monthTotals.received)} accent="green" />
          <Kpi label="A receber" value={formatBRL(monthTotals.pending)} accent="amber" />
          <Kpi label="Por plano de saúde" value={String(healthPlanMonthCount)} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between border-b border-[var(--navy-06)] px-5 py-3">
          <h2 className="text-sm font-medium text-gray-900">Consultas de hoje</h2>
          <span className="flex items-center gap-2 text-xs">
            {pendingCount > 0 && <span className="text-amber-700">{pendingCount} aguardando pagamento</span>}
            {healthPlanConsultations.length > 0 && (
              <span className="text-gray-400">{healthPlanConsultations.length} por plano de saúde</span>
            )}
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma consulta com receita hoje.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Horário</th>
                  <th className="px-5 py-3 font-normal">Paciente</th>
                  <th className="px-5 py-3 font-normal">Procedimento</th>
                  <th className="px-5 py-3 font-normal">Valor</th>
                  <th className="px-5 py-3 font-normal">Status</th>
                  <th className="px-5 py-3 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="px-5 py-3 text-gray-600">{apptTime(e)}</td>
                    <td className="px-5 py-3 text-gray-900">{patientName(e)}</td>
                    <td className="px-5 py-3 text-gray-600">{e.procedure_name ?? '—'}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(Number(e.amount))}</td>
                    <td className="px-5 py-3">
                      <Badge className={`border-none ${STATUS[e.payment_status].style}`}>
                        {STATUS[e.payment_status].label}
                      </Badge>
                      {e.payment_status === 'paid' && e.payment_method && (
                        <span className="ml-2 text-xs text-gray-400">{METHOD_LABEL[e.payment_method]}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {(e.payment_status === 'realized' || e.payment_status === 'pending') && (
                        <Button
                          size="sm"
                          onClick={() => openConfirm(e)}
                          className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
                        >
                          Confirmar pagamento
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {healthPlanConsultations.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--navy-06)] px-5 py-3">
            <h2 className="text-sm font-medium text-gray-900">Consultas por plano de saúde — hoje</h2>
            {plansPresent.length > 1 && (
              <Select value={planFilter} onValueChange={(v) => setPlanFilter(v ?? 'all')}>
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue>{planFilter === 'all' ? 'Todos os planos' : planFilter}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os planos</SelectItem>
                  {plansPresent.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Horário</th>
                  <th className="px-5 py-3 font-normal">Paciente</th>
                  <th className="px-5 py-3 font-normal">Plano</th>
                </tr>
              </thead>
              <tbody>
                {filteredConsultations.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="px-5 py-3 text-gray-600">{formatTime(c.scheduled_at)}</td>
                    <td className="px-5 py-3 text-gray-900">{c.patient_name}</td>
                    <td className="px-5 py-3 text-gray-600">{c.health_plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          {confirming && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                {patientName(confirming)} — {confirming.procedure_name ?? 'Consulta'} ·{' '}
                <span className="font-medium text-gray-900">{formatBRL(Number(confirming.amount))}</span>
              </p>
              <div>
                <label className="mb-1 block text-sm text-gray-700">Forma de pagamento</label>
                <Select value={method} onValueChange={(v) => setMethod(v as RevenuePaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={confirmPayment}
              disabled={saving}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Confirmando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' }) {
  const valueColor =
    accent === 'green' ? 'text-green-700' : accent === 'amber' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-[var(--navy-06)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-medium ${valueColor}`}>{value}</p>
    </div>
  )
}
