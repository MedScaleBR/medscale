'use client'

import { useState } from 'react'
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
import type { Database, RevenueStatus } from '@/types/database'

type RevenueEntry = Database['public']['Tables']['revenue_entries']['Row']

const STATUS_LABEL: Record<string, string> = {
  previsto: 'Previsto',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
}

const STATUS_STYLE: Record<string, string> = {
  previsto: 'bg-[var(--navy-06)] text-[var(--navy)]',
  confirmado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-600',
}

const EMPTY_FORM = {
  amount: '',
  status: 'previsto' as RevenueStatus,
  payment_method: '',
  notes: '',
  entry_date: new Date().toISOString().split('T')[0],
}

export function RevenueClient({ initialEntries }: { initialEntries: RevenueEntry[] }) {
  const [entries, setEntries] = useState(initialEntries)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const total = entries.reduce((s, e) => (e.status !== 'cancelado' ? s + Number(e.amount) : s), 0)

  const handleCreate = async () => {
    if (!form.amount) return
    setSaving(true)
    try {
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      })
      if (res.ok) {
        const created = await res.json()
        setEntries((prev) => [created, ...prev])
        setForm(EMPTY_FORM)
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Total do período: <span className="font-medium text-gray-900">{formatBRL(total)}</span>
        </p>
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Nova entrada
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {entries.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma entrada de receita registrada.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Data</th>
                <th className="px-5 py-3 font-normal">Valor</th>
                <th className="px-5 py-3 font-normal">Forma de pagamento</th>
                <th className="px-5 py-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                  <td className="px-5 py-3 text-gray-600">{new Date(e.entry_date).toLocaleDateString('pt-BR')}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{formatBRL(Number(e.amount))}</td>
                  <td className="px-5 py-3 text-gray-600">{e.payment_method ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge className={`border-none ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</Badge>
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
              <Label htmlFor="payment_method">Forma de pagamento</Label>
              <Input
                id="payment_method"
                placeholder="Pix, cartão, dinheiro..."
                value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as RevenueStatus }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="previsto">Previsto</SelectItem>
                  <SelectItem value="confirmado">Confirmado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
