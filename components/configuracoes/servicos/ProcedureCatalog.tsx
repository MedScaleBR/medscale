'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import type { Database } from '@/types/database'

export type Procedure = Database['public']['Tables']['procedure_catalog']['Row']

const EMPTY_PROC = { name: '', code: '', default_price: '', duration_min: '' }

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Catálogo de uma unidade. Controlado: a lista vive no pai (uma por unidade)
// e as rotas recebem ?workspace_id= para gravar na unidade escolhida, não na
// ativa da sessão.
export function ProcedureCatalog({
  workspaceId,
  procedures,
  onChange,
}: {
  workspaceId: string
  procedures: Procedure[]
  onChange: (next: Procedure[]) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Procedure | null>(null)
  const [form, setForm] = useState(EMPTY_PROC)
  const [savingProc, setSavingProc] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qs = `?workspace_id=${workspaceId}`

  const openNew = () => {
    setEditing(null)
    setForm(EMPTY_PROC)
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (p: Procedure) => {
    setEditing(p)
    setForm({
      name: p.name,
      code: p.code ?? '',
      default_price: String(p.default_price),
      duration_min: p.duration_min != null ? String(p.duration_min) : '',
    })
    setError(null)
    setDialogOpen(true)
  }

  const saveProcedure = async () => {
    const price = Number(form.default_price)
    if (!form.name.trim() || !Number.isFinite(price) || price < 0) return
    setSavingProc(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        default_price: price,
        duration_min: form.duration_min ? Number(form.duration_min) : null,
      }
      const res = await fetch(editing ? `/api/procedures/${editing.id}${qs}` : `/api/procedures${qs}`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        const saved = data as Procedure
        onChange(
          editing
            ? procedures.map((p) => (p.id === saved.id ? saved : p))
            : [...procedures, saved].sort((a, b) => a.name.localeCompare(b.name)),
        )
        setDialogOpen(false)
      } else {
        setError(data.error ?? 'Erro ao salvar.')
      }
    } finally {
      setSavingProc(false)
    }
  }

  const removeProcedure = async (p: Procedure) => {
    if (!confirm(`Remover "${p.name}" do catálogo? Consultas antigas não são afetadas.`)) return
    const res = await fetch(`/api/procedures/${p.id}${qs}`, { method: 'DELETE' })
    if (res.ok) onChange(procedures.filter((x) => x.id !== p.id))
  }

  return (
    <>
      <div className="rounded-xl border border-[var(--navy-06)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-900">Catálogo de procedimentos</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Nome, preço e duração de cada procedimento desta unidade. Alimenta a Clara, a agenda e o ciclo de receita.
            </p>
          </div>
          <Button
            onClick={openNew}
            className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
        <Separator className="my-4" />
        {procedures.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Nenhum procedimento cadastrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-sm">
              <thead>
                <tr className="border-b border-[var(--navy-06)] text-left text-xs text-gray-400">
                  <th className="py-2 pr-3 font-normal">Procedimento</th>
                  <th className="py-2 pr-3 font-normal">Preço</th>
                  <th className="py-2 pr-3 font-normal">Duração</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {procedures.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--navy-06)] last:border-0">
                    <td className="py-2.5 pr-3 text-gray-900">
                      {p.name}
                      {p.code ? <span className="ml-2 text-xs text-gray-400">{p.code}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600">{formatBRL(Number(p.default_price))}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{p.duration_min ? `${p.duration_min} min` : '—'}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="mr-3 text-gray-400 hover:text-gray-700"
                        aria-label={`Editar ${p.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeProcedure(p)}
                        className="text-gray-400 hover:text-red-600"
                        aria-label={`Remover ${p.name}`}
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar procedimento' : 'Novo procedimento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="proc-name">Nome</Label>
              <Input
                id="proc-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Consulta de rotina"
              />
            </div>
            <div>
              <Label htmlFor="proc-price">Preço padrão (R$)</Label>
              <Input
                id="proc-price"
                type="number"
                min={0}
                value={form.default_price}
                onChange={(e) => setForm((f) => ({ ...f, default_price: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="proc-duration">Duração (min)</Label>
                <Input
                  id="proc-duration"
                  type="number"
                  min={0}
                  value={form.duration_min}
                  onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="proc-code">Código (opcional)</Label>
                <Input
                  id="proc-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                />
              </div>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-600">
              {friendlyErrorMessage(error, 'Não foi possível salvar o procedimento. Tente novamente.')}
            </p>
          )}
          <DialogFooter>
            <Button
              onClick={saveProcedure}
              disabled={savingProc}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              {savingProc ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
