'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const NONE = '__none__'

export function FinanceCategoryPicker({
  kind, tree, categoryId, subcategoryId, onChange, disabled,
}: {
  kind: 'pf' | 'pj'
  tree: FinanceCategoryTree
  categoryId: string | null
  subcategoryId: string | null
  onChange: (next: { categoryId: string | null; subcategoryId: string | null }) => void
  disabled?: boolean
}) {
  // Arquivadas ficam fora da seleção, exceto a que já está selecionada neste
  // lançamento — senão o Select mostraria o placeholder e o lançamento
  // pareceria sem categoria enquanto o estado ainda guarda o id.
  const current = tree[kind].find((c) => c.id === categoryId) ?? null
  const roots = tree[kind].filter((c) => !c.isArchived || c.id === categoryId)
  const subs = (current?.children ?? []).filter((s) => !s.isArchived || s.id === subcategoryId)
  const label = (n: { name: string; isArchived: boolean }) =>
    n.isArchived ? `${n.name} (arquivada)` : n.name

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-gray-400">Categoria</label>
        <Select
          value={categoryId ?? NONE}
          disabled={disabled}
          onValueChange={(v) => onChange({ categoryId: v === NONE ? null : v, subcategoryId: null })}
        >
          <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem categoria</SelectItem>
            {roots.map((c) => (
              <SelectItem key={c.id} value={c.id}>{label(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {subs.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">Subcategoria</label>
          <Select
            value={subcategoryId ?? NONE}
            disabled={disabled}
            onValueChange={(v) => onChange({ categoryId, subcategoryId: v === NONE ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nenhuma</SelectItem>
              {subs.map((s) => (
                <SelectItem key={s.id} value={s.id}>{label(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
