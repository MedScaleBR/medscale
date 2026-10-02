'use client'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GUIDE_TYPE_LABELS } from '@/lib/billing/constants'
import { formatCents, parseCents, centsToInput } from './money'
import type { TissGuideType } from '@/types/database'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

export interface ProcedureRow {
  id: string
  insurer_id: string
  tuss_code: string
  description: string
  price_cents: number
  guide_type: TissGuideType
  is_active: boolean
}

const EMPTY = { tuss_code: '', description: '', price: '', guide_type: 'consulta' as TissGuideType, is_active: true }

// Tabela TUSS de uma operadora — é dela que sai o valor da guia.
export function ProcedureTable({ insurerId }: { insurerId: string }) {
  const [procedures, setProcedures] = useState<ProcedureRow[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProcedureRow | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/billing/insurers/${insurerId}/procedures?all=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProcedureRow[]) => !cancelled && setProcedures(rows))
    return () => {
      cancelled = true
    }
  }, [insurerId])

  const openNew = () => {
    setEditing(null)
    setForm(EMPTY)
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (p: ProcedureRow) => {
    setEditing(p)
    setForm({
      tuss_code: p.tuss_code,
      description: p.description,
      price: centsToInput(p.price_cents),
      guide_type: p.guide_type,
      is_active: p.is_active,
    })
    setError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    const priceCents = parseCents(form.price)
    if (priceCents == null) {
      setError('Valor inválido. Use o formato 150,00.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/billing/insurers/${insurerId}/procedures`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { procedure_id: editing.id } : {}),
          tuss_code: form.tuss_code,
          description: form.description,
          price_cents: priceCents,
          guide_type: form.guide_type,
          is_active: form.is_active,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar.')
        return
      }
      const saved = data as ProcedureRow
      setProcedures((prev) =>
        (editing ? (prev ?? []).map((p) => (p.id === saved.id ? saved : p)) : [...(prev ?? []), saved]).sort((a, b) =>
          a.description.localeCompare(b.description),
        ),
      )
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: ProcedureRow) => {
    if (!confirm(`Remover ${p.tuss_code} — ${p.description}? Guias já geradas não são afetadas.`)) return
    const res = await fetch(`/api/billing/insurers/${insurerId}/procedures?procedure_id=${p.id}`, { method: 'DELETE' })
    if (res.ok) setProcedures((prev) => (prev ?? []).filter((x) => x.id !== p.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">Procedimentos (TUSS)</p>
        <Button variant="ghost" size="sm" onClick={openNew} className="gap-1 text-[var(--cyan-dark)]">
          <Plus className="h-3.5 w-3.5" />
          Procedimento
        </Button>
      </div>
      {procedures === null ? (
        <p className="py-4 text-center text-xs text-gray-400">Carregando…</p>
      ) : procedures.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">
          Nenhum procedimento. Cadastre pelo menos a consulta para as guias saírem com valor.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                <th className="py-2 pr-3 font-normal">TUSS</th>
                <th className="py-2 pr-3 font-normal">Descrição</th>
                <th className="py-2 pr-3 font-normal">Guia</th>
                <th className="py-2 pr-3 font-normal">Valor</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {procedures.map((p) => (
                <tr key={p.id} className="border-b border-[var(--navy-06)] last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-gray-600">{p.tuss_code}</td>
                  <td className={p.is_active ? 'py-2 pr-3 text-gray-900' : 'py-2 pr-3 text-gray-400 line-through'}>
                    {p.description}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{GUIDE_TYPE_LABELS[p.guide_type]}</td>
                  <td className="py-2 pr-3 text-gray-600">{formatCents(p.price_cents)}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="mr-3 text-gray-400 hover:text-gray-700"
                      aria-label={`Editar ${p.description}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="text-gray-400 hover:text-red-600"
                      aria-label={`Remover ${p.description}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar procedimento' : 'Novo procedimento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tuss_code">Código TUSS</Label>
                <Input
                  id="tuss_code"
                  maxLength={10}
                  placeholder="10101012"
                  value={form.tuss_code}
                  onChange={(e) => setForm((f) => ({ ...f, tuss_code: e.target.value.trim() }))}
                />
              </div>
              <div>
                <Label htmlFor="proc_price">Valor (R$)</Label>
                <Input
                  id="proc_price"
                  inputMode="decimal"
                  placeholder="150,00"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="proc_description">Descrição</Label>
              <Input
                id="proc_description"
                maxLength={150}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>Tipo de guia</Label>
              <Select
                value={form.guide_type}
                onValueChange={(v) => v && setForm((f) => ({ ...f, guide_type: v as TissGuideType }))}
              >
                <SelectTrigger>
                  <SelectValue>{(v) => GUIDE_TYPE_LABELS[v as TissGuideType] ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consulta">Consulta</SelectItem>
                  <SelectItem value="sp_sadt">SP/SADT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between pt-1">
              <span className="text-sm text-gray-700">Ativo</span>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
            </label>
            {error && <p className="text-xs text-red-600">{friendlyErrorMessage(error, "Não foi possível concluir esta ação de faturamento. Confira os dados e tente novamente.")}</p>}
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
        </DialogContent>
      </Dialog>
    </div>
  )
}
