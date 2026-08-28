'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Plus, X } from 'lucide-react'
import { useAnalyticsBase } from '@/lib/session/session-context'
import { trackWaitlistPatientAdded } from '@/lib/analytics/posthog'
import type { Database, WaitlistStatus } from '@/types/database'

type WaitlistEntry = Database['public']['Tables']['waitlist']['Row']

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: 'Aguardando',
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
}

const STATUS_STYLE: Record<WaitlistStatus, string> = {
  waiting: 'bg-[var(--cyan-10)] text-[var(--cyan-dark)]',
  scheduled: 'bg-green-100 text-green-700',
  cancelled: 'bg-[var(--navy-06)] text-[var(--navy)]',
}

const EMPTY_FORM = { patient_name: '', patient_phone: '', notes: '' }

export function WaitlistClient({ initialEntries }: { initialEntries: WaitlistEntry[] }) {
  const [entries, setEntries] = useState(initialEntries)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const analyticsBase = useAnalyticsBase()

  const handleCreate = async () => {
    if (!form.patient_name || !form.patient_phone) return
    setSaving(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const created = await res.json()
        setEntries((prev) => [created, ...prev])
        setForm(EMPTY_FORM)
        setOpen(false)
        trackWaitlistPatientAdded(analyticsBase)
      }
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (id: string, status: WaitlistStatus) => {
    const res = await fetch(`/api/waitlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)))
    }
  }

  const removeEntry = async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
    await fetch(`/api/waitlist/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Adicionar à lista
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {entries.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Ninguém na lista de espera.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Paciente</th>
                <th className="px-5 py-3 font-normal">Telefone</th>
                <th className="px-5 py-3 font-normal">Observações</th>
                <th className="px-5 py-3 font-normal">Status</th>
                <th className="px-5 py-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--navy-06)] last:border-0">
                  <td className="px-5 py-3 font-medium text-gray-900">{e.patient_name}</td>
                  <td className="px-5 py-3 text-gray-600">{e.patient_phone}</td>
                  <td className="px-5 py-3 text-gray-600">{e.notes ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Select value={e.status} onValueChange={(v) => v && updateStatus(e.id, v as WaitlistStatus)}>
                      <SelectTrigger className={`h-7 w-32 border-none text-xs ${STATUS_STYLE[e.status]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as WaitlistStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => removeEntry(e.id)} className="text-gray-300 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
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
            <DialogTitle>Adicionar à lista de espera</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="patient_name">Nome do paciente</Label>
              <Input
                id="patient_name"
                value={form.patient_name}
                onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="patient_phone">Telefone (E.164)</Label>
              <Input
                id="patient_phone"
                placeholder="+5511999999999"
                value={form.patient_phone}
                onChange={(e) => setForm((f) => ({ ...f, patient_phone: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="notes">Observações</Label>
              <Input id="notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
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
