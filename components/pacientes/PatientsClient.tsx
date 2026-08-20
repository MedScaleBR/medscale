'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Plus, Search } from 'lucide-react'
import type { Database } from '@/types/database'

type Patient = Database['public']['Tables']['patients']['Row']

export function PatientsClient({ initialPatients }: { initialPatients: Patient[] }) {
  const [patients, setPatients] = useState(initialPatients)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  const filtered = patients.filter(
    (p) =>
      p.full_name.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search)
  )

  const handleCreate = async () => {
    if (!form.full_name || !form.phone) return
    setSaving(true)
    try {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const created = await res.json()
        setPatients((prev) => [created, ...prev])
        setForm({ full_name: '', phone: '', email: '' })
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Novo paciente
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhum paciente encontrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] bg-[var(--navy-06)]/40 text-left text-xs text-gray-400">
                <th className="px-5 py-3 font-normal">Nome</th>
                <th className="px-5 py-3 font-normal">Telefone</th>
                <th className="px-5 py-3 font-normal">E-mail</th>
                <th className="px-5 py-3 font-normal">Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-[var(--navy-06)] last:border-0 hover:bg-[var(--navy-06)]/40">
                  <td className="px-5 py-3">
                    <Link href={`/pacientes/${p.id}`} className="font-medium text-gray-900 hover:text-[var(--cyan-dark)]">
                      {p.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{p.phone}</td>
                  <td className="px-5 py-3 text-gray-600">{p.email ?? '—'}</td>
                  <td className="px-5 py-3">
                    {p.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {p.tags.map((t) => (
                          <Badge key={t} className="border-none bg-[var(--navy-06)] text-[var(--navy)]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo paciente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="full_name">Nome completo</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="phone">Telefone (E.164)</Label>
              <Input
                id="phone"
                placeholder="+5511999999999"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="email">E-mail (opcional)</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
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
