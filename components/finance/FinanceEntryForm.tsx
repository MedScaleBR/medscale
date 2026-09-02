'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FinanceCategoryPicker } from './FinanceCategoryPicker'
import type { FinanceCategoryTree } from '@/lib/finance/categories'
import type { FinanceEntry } from '@/lib/finance/types'

const NONE = '__none__'
const todayISO = () => new Date().toISOString().slice(0, 10)

export function FinanceEntryForm({
  open, onOpenChange, kind, tree, workspaces, entry, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'pf' | 'pj'
  tree: FinanceCategoryTree
  workspaces: { id: string; name: string }[]
  entry: FinanceEntry | null
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Semeia os campos quando o diálogo abre (criar = defaults; editar = dados
  // do lançamento). setState síncrono é intencional aqui — roda só na abertura.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setDate(entry?.entry_date ?? todayISO())
    setDescription(entry?.description ?? '')
    setAmount(entry ? String(entry.amount) : '')
    setCategoryId(entry?.category_id ?? null)
    setSubcategoryId(entry?.subcategory_id ?? null)
    setWorkspaceId(entry?.workspace_id ?? null)
  }, [open, entry])

  const submit = () => {
    setError(null)
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) { setError('Informe um valor maior que zero.'); return }

    const payload = {
      type: kind,
      entry_date: date,
      description: description.trim() || null,
      amount: value,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      workspace_id: kind === 'pj' ? workspaceId : null,
    }
    const url = entry ? `/api/finance/entries/${entry.id}` : '/api/finance/entries'
    const method = entry ? 'PATCH' : 'POST'

    startTransition(async () => {
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Não foi possível salvar.')
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'Editar lançamento' : 'Novo lançamento'} — {kind === 'pf' ? 'Pessoal' : 'Clínica'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Data</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Valor (R$)</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          <FinanceCategoryPicker
            kind={kind}
            tree={tree}
            categoryId={categoryId}
            subcategoryId={subcategoryId}
            onChange={({ categoryId, subcategoryId }) => { setCategoryId(categoryId); setSubcategoryId(subcategoryId) }}
          />

          <div>
            <label className="mb-1 block text-xs text-gray-400">Descrição (opcional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Escola João" />
          </div>

          {kind === 'pj' && workspaces.length > 1 && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Unidade</label>
              <Select
                items={{ [NONE]: 'Consolidado (sem unidade)', ...Object.fromEntries(workspaces.map((w) => [w.id, w.name])) }}
                value={workspaceId ?? NONE}
                onValueChange={(v) => setWorkspaceId(v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Consolidado (sem unidade)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Consolidado (sem unidade)</SelectItem>
                  {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
