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
import { Plus, Star } from 'lucide-react'
import type { Database } from '@/types/database'

type WorkspaceRow = Pick<
  Database['public']['Tables']['workspaces']['Row'],
  'id' | 'name' | 'slug' | 'address' | 'city' | 'state' | 'zip_code' | 'is_active' | 'is_default' | 'display_order'
>

const EMPTY_FORM = { name: '', address: '', city: '', state: '', zip_code: '' }

interface WorkspacesClientProps {
  initialWorkspaces: WorkspaceRow[]
  canManage: boolean
  apiBase?: string // '/api/workspaces' (padrão) ou '/api/admin/accounts/<id>/workspaces'
}

export function WorkspacesClient({ initialWorkspaces, canManage, apiBase = '/api/workspaces' }: WorkspacesClientProps) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState(false)

  const handleCepChange = async (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    const masked = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
    setForm((f) => ({ ...f, zip_code: masked }))
    setCepError(false)

    if (digits.length !== 8) return

    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) {
        setCepError(true)
        return
      }
      setForm((f) => ({
        ...f,
        address: [data.logradouro, data.bairro].filter(Boolean).join(', '),
        city: data.localidade || f.city,
        state: data.uf || f.state,
      }))
    } catch {
      setCepError(true)
    } finally {
      setCepLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!form.name) return
    setSaving(true)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const created = await res.json()
        setWorkspaces((prev) => [...prev, created])
        setForm(EMPTY_FORM)
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (id: string) => {
    const res = await fetch(`${apiBase}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    })
    if (res.ok) {
      setWorkspaces((prev) => prev.map((w) => ({ ...w, is_default: w.id === id })))
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() => setOpen(true)}
            className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Nova unidade
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((w) => (
          <div key={w.id} className="rounded-xl border border-[var(--navy-06)] bg-white p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-gray-900">{w.name}</p>
              {w.is_default && <Badge className="border-none bg-[var(--cyan-10)] text-[var(--cyan-dark)]">Padrão</Badge>}
            </div>
            {(w.address || w.city) && (
              <p className="mt-1 text-xs text-gray-400">
                {[w.address, w.city, w.state].filter(Boolean).join(', ')}
                {w.zip_code ? ` — ${w.zip_code}` : ''}
              </p>
            )}
            {canManage && !w.is_default && (
              <button
                onClick={() => handleSetDefault(w.id)}
                className="mt-3 flex items-center gap-1 text-xs text-[var(--cyan-dark)] hover:underline"
              >
                <Star className="h-3 w-3" />
                Definir como padrão
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova unidade</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="zip_code">CEP</Label>
              <Input
                id="zip_code"
                value={form.zip_code}
                onChange={(e) => handleCepChange(e.target.value)}
                placeholder="00000-000"
                inputMode="numeric"
                maxLength={9}
              />
              {cepLoading && <p className="mt-1 text-xs text-gray-400">Buscando endereço...</p>}
              {cepError && <p className="mt-1 text-xs text-red-500">CEP não encontrado</p>}
            </div>
            <div>
              <Label htmlFor="address">Endereço</Label>
              <Input id="address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="state">Estado</Label>
                <Input id="state" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </div>
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
