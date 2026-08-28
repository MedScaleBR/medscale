'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Plus } from 'lucide-react'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/lib/revenue/cycle'
import type { RevenueTotals } from '@/lib/revenue/summary'
import type { RevenuePaymentMethod, RevenuePaymentStatus, RevenueStatus } from '@/types/database'

export interface RevenueLedgerEntry {
  id: string
  amount: number | string
  status: RevenueStatus
  payment_status: RevenuePaymentStatus
  payment_method: RevenuePaymentMethod | null
  paid_at: string | null
  due_date: string | null
  entry_date: string
  procedure_name: string | null
  installments: number
  notes: string | null
  appointment_id: string | null
  appointments: { scheduled_at: string; patient_name: string } | null
  patients: { full_name: string } | null
}

const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS) as [RevenuePaymentMethod, string][]

// Presets do filtro de status → valor do query param `status`.
const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Prevista', value: 'pending' },
  { label: 'Aguardando pagamento', value: 'realized' },
  { label: 'Paga', value: 'paid' },
  { label: 'Cancelada / reembolsada', value: 'cancelled,refunded' },
]

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const formatDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')

function patientName(e: RevenueLedgerEntry): string {
  return e.patients?.full_name ?? e.appointments?.patient_name ?? '—'
}

// Últimos 12 meses (YYYY-MM) a partir do mês atual, para o seletor.
function recentMonths(currentMonth: string): string[] {
  const [y, m] = currentMonth.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    return d.toISOString().slice(0, 7)
  })
}
const monthLabel = (month: string) =>
  new Date(month + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

const EMPTY_FORM = {
  amount: '',
  status: 'previsto' as RevenueStatus,
  payment_method: '' as RevenuePaymentMethod | '',
  notes: '',
  entry_date: new Date().toISOString().split('T')[0],
}

export function RevenueClient({
  initialEntries,
  totals,
  isOwner,
  month,
  currentMonth,
  statusFilter,
}: {
  initialEntries: RevenueLedgerEntry[]
  totals: RevenueTotals | null
  isOwner: boolean
  month: string
  currentMonth: string
  statusFilter: RevenuePaymentStatus[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState<RevenueLedgerEntry | null>(null)
  const [confirmMethod, setConfirmMethod] = useState<RevenuePaymentMethod>('pix')

  const statusParam =
    statusFilter.length >= 5
      ? 'all'
      : [...statusFilter].sort().join(',') === 'cancelled,refunded'
        ? 'cancelled,refunded'
        : statusFilter.join(',')

  const applyFilters = (next: { month?: string | null; status?: string | null }) => {
    const params = new URLSearchParams()
    const m = next.month ?? month
    const s = next.status ?? statusParam
    if (m !== currentMonth) params.set('month', m)
    if (s !== 'all') params.set('status', s)
    startTransition(() => router.push(`/receita${params.toString() ? `?${params}` : ''}`))
  }

  const handleCreate = async () => {
    if (!form.amount) return
    setSaving(true)
    try {
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(form.amount),
          status: form.status,
          payment_method: form.payment_method || null,
          notes: form.notes || null,
          entry_date: form.entry_date,
        }),
      })
      if (res.ok) {
        setForm(EMPTY_FORM)
        setOpen(false)
        startTransition(() => router.refresh())
      }
    } finally {
      setSaving(false)
    }
  }

  const confirmPayment = async () => {
    if (!confirming) return
    setSaving(true)
    try {
      const res = await fetch(`/api/revenue-entries/${confirming.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: confirmMethod }),
      })
      if (res.ok) {
        setConfirming(null)
        startTransition(() => router.refresh())
      }
    } finally {
      setSaving(false)
    }
  }

  const busy = pending || saving

  return (
    <div className="space-y-4">
      {isOwner && totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Previsto no período" value={formatBRL(totals.projected)} />
          <Kpi label="Realizado" value={formatBRL(totals.realized)} />
          <Kpi label="Recebido" value={formatBRL(totals.received)} accent="green" />
          <Kpi label="A receber" value={formatBRL(totals.pending)} accent="amber" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={month} onValueChange={(v) => applyFilters({ month: v })}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue>{month === 'all' ? 'Todos os meses' : monthLabel(month)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {recentMonths(currentMonth).map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusParam} onValueChange={(v) => applyFilters({ status: v })}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue>
                {STATUS_FILTERS.find((f) => f.value === statusParam)?.label ?? 'Todos os status'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Nova entrada
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {initialEntries.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma entrada no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                  <th className="px-5 py-3 font-normal">Data</th>
                  <th className="px-5 py-3 font-normal">Paciente</th>
                  <th className="px-5 py-3 font-normal">Procedimento</th>
                  <th className="px-5 py-3 font-normal">Valor</th>
                  <th className="px-5 py-3 font-normal">Forma de pagamento</th>
                  <th className="px-5 py-3 font-normal">Status</th>
                  <th className="px-5 py-3 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {initialEntries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="px-5 py-3 text-gray-600">{formatDate(e.entry_date)}</td>
                    <td className="px-5 py-3 text-gray-900">{patientName(e)}</td>
                    <td className="px-5 py-3 text-gray-600">{e.procedure_name ?? '—'}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(Number(e.amount))}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {e.payment_method ? PAYMENT_METHOD_LABELS[e.payment_method] : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge className={`border-none ${PAYMENT_STATUS_LABELS[e.payment_status].style}`}>
                        {PAYMENT_STATUS_LABELS[e.payment_status].label}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {(e.payment_status === 'pending' || e.payment_status === 'realized') && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(e)
                            setConfirmMethod('pix')
                          }}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova entrada de receita</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="amount">Valor (R$)</Label>
              <Input
                id="amount"
                type="number"
                min={0}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="entry_date">Data</Label>
              <Input
                id="entry_date"
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as RevenueStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="previsto">Prevista</SelectItem>
                  <SelectItem value="confirmado">Paga</SelectItem>
                  <SelectItem value="cancelado">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={form.payment_method || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v as RevenuePaymentMethod }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Opcional">
                    {(v: string) => (v ? PAYMENT_METHOD_LABELS[v as RevenuePaymentMethod] : 'Opcional')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Observações</Label>
              <Input
                id="notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={saving || !form.amount}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <Label>Forma de pagamento</Label>
                <Select value={confirmMethod} onValueChange={(v) => setConfirmMethod(v as RevenuePaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHOD_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
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
